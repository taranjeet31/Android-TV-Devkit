use serde::{Serialize, Deserialize};
use std::sync::Mutex;
use std::net::UdpSocket;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkRequest {
    pub id: String,
    pub method: String,
    pub url: String,
    pub host: String,
    pub port: u16,
    pub timestamp: u64,
    pub status: String, // "Pending", "Active", "Completed", "Failed"
    pub size_bytes: u64,
    pub duration_ms: u64,
}

pub struct ProxyState {
    pub shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    pub active_port: Mutex<Option<u16>>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self {
            shutdown_tx: Mutex::new(None),
            active_port: Mutex::new(None),
        }
    }
}

/// Helper to get Mac's local network IP address
#[tauri::command]
pub fn get_host_ip() -> Result<String, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    let addr = socket.local_addr().map_err(|e| e.to_string())?;
    Ok(addr.ip().to_string())
}

/// Configure global HTTP proxy on Android TV device
#[tauri::command]
pub fn enable_device_proxy(serial: String, proxy_ip: String, proxy_port: u16) -> Result<(), String> {
    let proxy_str = format!("{}:{}", proxy_ip, proxy_port);
    let output = std::process::Command::new("adb")
        .args(&["-s", &serial, "shell", "settings", "put", "global", "http_proxy", &proxy_str])
        .output()
        .map_err(|e| e.to_string())?;
        
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Clear global HTTP proxy on Android TV device
#[tauri::command]
pub fn disable_device_proxy(serial: String) -> Result<(), String> {
    // Clear proxy settings
    let _ = std::process::Command::new("adb")
        .args(&["-s", &serial, "shell", "settings", "delete", "global", "http_proxy"])
        .status();
        
    let _ = std::process::Command::new("adb")
        .args(&["-s", &serial, "shell", "settings", "put", "global", "http_proxy", ":0"])
        .status();
        
    Ok(())
}

fn parse_request_line(buf: &[u8]) -> Option<(String, String)> {
    let text = std::str::from_utf8(buf).ok()?;
    let first_line = text.lines().next()?;
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() >= 2 {
        Some((parts[0].to_string(), parts[1].to_string()))
    } else {
        None
    }
}

fn parse_host_port(method: &str, url: &str) -> Option<(String, u16)> {
    if method == "CONNECT" {
        let parts: Vec<&str> = url.split(':').collect();
        let host = parts[0].to_string();
        let port = if parts.len() > 1 {
            parts[1].parse::<u16>().unwrap_or(443)
        } else {
            443
        };
        Some((host, port))
    } else {
        let temp = if url.starts_with("http://") {
            &url[7..]
        } else if url.starts_with("https://") {
            &url[8..]
        } else {
            url
        };
        let host_part = temp.split('/').next()?;
        let parts: Vec<&str> = host_part.split(':').collect();
        let host = parts[0].to_string();
        let port = if parts.len() > 1 {
            parts[1].parse::<u16>().unwrap_or(80)
        } else {
            80
        };
        Some((host, port))
    }
}

/// Starts the network proxy server on the specified port
#[tauri::command]
pub fn start_proxy(app: AppHandle, state: State<'_, ProxyState>, port: u16) -> Result<(), String> {
    // Stop any running proxy
    let _ = stop_proxy(state.clone());

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    {
        let mut lock = state.shutdown_tx.lock().unwrap();
        *lock = Some(shutdown_tx);
        let mut port_lock = state.active_port.lock().unwrap();
        *port_lock = Some(port);
    }

    let addr = format!("0.0.0.0:{}", port);
    
    // Spawn task
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(_) => return,
        };

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    break;
                }
                conn = listener.accept() => {
                    if let Ok((mut client_stream, _)) = conn {
                        let app_clone = app.clone();
                        tokio::spawn(async move {
                            let mut buf = [0u8; 4096];
                            let n = match client_stream.read(&mut buf).await {
                                Ok(n) if n > 0 => n,
                                _ => return,
                            };
                            
                            let req_info = match parse_request_line(&buf[..n]) {
                                Some((method, url)) => {
                                    if let Some((host, port)) = parse_host_port(&method, &url) {
                                        Some((method, url, host, port))
                                    } else {
                                        None
                                    }
                                }
                                None => None,
                            };
                            
                            if let Some((method, url, host, port)) = req_info {
                                let req_id = format!("req_{}_{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis(), port);
                                let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                                
                                // Send initial request log
                                let start_req = NetworkRequest {
                                    id: req_id.clone(),
                                    method: method.clone(),
                                    url: url.clone(),
                                    host: host.clone(),
                                    port,
                                    timestamp,
                                    status: "Active".to_string(),
                                    size_bytes: 0,
                                    duration_ms: 0,
                                };
                                let _ = app_clone.emit("network-request", start_req);

                                let start_time = Instant::now();
                                let target_addr = format!("{}:{}", host, port);
                                
                                match TcpStream::connect(&target_addr).await {
                                    Ok(mut target_stream) => {
                                        let mut total_bytes = 0;
                                        if method == "CONNECT" {
                                            // SSL Tunneling
                                            if client_stream.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await.is_ok() {
                                                let (mut client_read, mut client_write) = client_stream.into_split();
                                                let (mut target_read, mut target_write) = target_stream.into_split();
                                                
                                                let client_to_target = tokio::spawn(async move {
                                                    let mut c_to_t_buf = vec![0u8; 8192];
                                                    let mut c_bytes = 0;
                                                    while let Ok(n) = client_read.read(&mut c_to_t_buf).await {
                                                        if n == 0 { break; }
                                                        if target_write.write_all(&c_to_t_buf[..n]).await.is_err() { break; }
                                                        c_bytes += n as u64;
                                                    }
                                                    c_bytes
                                                });
                                                
                                                let target_to_client = tokio::spawn(async move {
                                                    let mut t_to_c_buf = vec![0u8; 8192];
                                                    let mut t_bytes = 0;
                                                    while let Ok(n) = target_read.read(&mut t_to_c_buf).await {
                                                        if n == 0 { break; }
                                                        if client_write.write_all(&t_to_c_buf[..n]).await.is_err() { break; }
                                                        t_bytes += n as u64;
                                                    }
                                                    t_bytes
                                                });
                                                
                                                let c_res = client_to_target.await.unwrap_or(0);
                                                let t_res = target_to_client.await.unwrap_or(0);
                                                total_bytes = c_res + t_res;
                                            }
                                        } else {
                                            // HTTP proxy (forward initial request bytes)
                                            if target_stream.write_all(&buf[..n]).await.is_ok() {
                                                let (mut client_read, mut client_write) = client_stream.into_split();
                                                let (mut target_read, mut target_write) = target_stream.into_split();
                                                
                                                let client_to_target = tokio::spawn(async move {
                                                    let mut c_to_t_buf = vec![0u8; 8192];
                                                    let mut c_bytes = 0;
                                                    while let Ok(n) = client_read.read(&mut c_to_t_buf).await {
                                                        if n == 0 { break; }
                                                        if target_write.write_all(&c_to_t_buf[..n]).await.is_err() { break; }
                                                        c_bytes += n as u64;
                                                    }
                                                    c_bytes
                                                });
                                                
                                                let target_to_client = tokio::spawn(async move {
                                                    let mut t_to_c_buf = vec![0u8; 8192];
                                                    let mut t_bytes = 0;
                                                    while let Ok(n) = target_read.read(&mut t_to_c_buf).await {
                                                        if n == 0 { break; }
                                                        if client_write.write_all(&t_to_c_buf[..n]).await.is_err() { break; }
                                                        t_bytes += n as u64;
                                                    }
                                                    t_bytes
                                                });
                                                
                                                let c_res = client_to_target.await.unwrap_or(0);
                                                let t_res = target_to_client.await.unwrap_or(0);
                                                total_bytes = c_res + t_res + n as u64;
                                            }
                                        }
                                        
                                        let duration = start_time.elapsed().as_millis() as u64;
                                        
                                        let completed_req = NetworkRequest {
                                            id: req_id,
                                            method,
                                            url,
                                            host,
                                            port,
                                            timestamp,
                                            status: "Completed".to_string(),
                                            size_bytes: total_bytes,
                                            duration_ms: duration,
                                        };
                                        let _ = app_clone.emit("network-request", completed_req);
                                    }
                                    Err(_) => {
                                        let duration = start_time.elapsed().as_millis() as u64;
                                        let failed_req = NetworkRequest {
                                            id: req_id,
                                            method,
                                            url,
                                            host,
                                            port,
                                            timestamp,
                                            status: "Failed".to_string(),
                                            size_bytes: 0,
                                            duration_ms: duration,
                                        };
                                        let _ = app_clone.emit("network-request", failed_req);
                                    }
                                }
                            }
                        });
                    }
                }
            }
        }
    });

    Ok(())
}

/// Stops the running proxy server
#[tauri::command]
pub fn stop_proxy(state: State<'_, ProxyState>) -> Result<(), String> {
    let mut lock = state.shutdown_tx.lock().unwrap();
    if let Some(tx) = lock.take() {
        let _ = tx.send(());
    }
    let mut port_lock = state.active_port.lock().unwrap();
    *port_lock = None;
    Ok(())
}

/// Gets the current running proxy port, if active
#[tauri::command]
pub fn get_active_proxy_port(state: State<'_, ProxyState>) -> Result<Option<u16>, String> {
    let lock = state.active_port.lock().unwrap();
    Ok(*lock)
}
