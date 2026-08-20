use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio_tungstenite::{accept_hdr_async, tungstenite::Message};
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};

use crate::mouse_capture::protocol::CursorMessage;

/// A handle to the running WebSocket server.
/// Clone freely — the inner Arc keeps the real state alive.
#[derive(Clone)]
#[allow(dead_code)]
pub struct WsServerHandle {
    /// Broadcast channel sender. Clone to get a new sender; all receivers get every message.
    pub tx: broadcast::Sender<String>,
    /// Channel to signal server shutdown.
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
    pub port: u16,
    pub session_token: String,
}

impl WsServerHandle {
    /// Broadcast a cursor message to all connected TV clients.
    pub fn broadcast(&self, msg: &CursorMessage) -> Result<()> {
        if let Ok(json) = msg.to_json() {
            // Ignore send errors — no connected clients is fine
            let _ = self.tx.send(json);
        }
        Ok(())
    }

    /// Gracefully stop the WebSocket server.
    pub async fn stop(&self) {
        let mut lock = self.shutdown_tx.lock().await;
        if let Some(tx) = lock.take() {
            let _ = tx.send(()).await;
        }
    }
}

/// Spin up a WebSocket server on the given port.
/// Returns a handle for broadcasting messages and stopping the server.
pub async fn start_ws_server(port: u16, session_token: String) -> Result<WsServerHandle> {
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await?;

    // Broadcast channel — capacity 256 buffered messages per client
    let (tx, _rx) = broadcast::channel::<String>(256);
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    let token_clone = session_token.clone();
    let tx_clone = tx.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                conn = listener.accept() => {
                    match conn {
                        Ok((stream, addr)) => {
                            let tx_c = tx_clone.clone();
                            let token = token_clone.clone();
                            tokio::spawn(handle_connection(stream, addr, tx_c, token));
                        }
                        Err(e) => {
                            eprintln!("[ws_server] accept error: {}", e);
                        }
                    }
                }
            }
        }
        eprintln!("[ws_server] shutdown complete");
    });

    Ok(WsServerHandle {
        tx,
        shutdown_tx: Arc::new(Mutex::new(Some(shutdown_tx))),
        port,
        session_token,
    })
}

async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    tx: broadcast::Sender<String>,
    session_token: String,
) {
    // Validate auth token from query string: ws://<host>:<port>?token=<session_token>
    let token_for_check = session_token.clone();
    let mut token_ok = false;

    let callback = |req: &Request, res: Response| -> std::result::Result<Response, tokio_tungstenite::tungstenite::http::Response<Option<String>>> {
        let uri = req.uri().to_string();
        if token_for_check.is_empty() {
            // No auth configured — allow all
            token_ok = true;
        } else if let Some(query) = req.uri().query() {
            // Parse ?token=...
            for part in query.split('&') {
                let mut kv = part.splitn(2, '=');
                if kv.next() == Some("token") {
                    if kv.next() == Some(token_for_check.as_str()) {
                        token_ok = true;
                    }
                }
            }
        }
        let _ = uri; // avoid unused warning
        Ok(res)
    };

    let ws_stream = match accept_hdr_async(stream, callback).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[ws_server] WS handshake error from {}: {}", addr, e);
            return;
        }
    };

    if !token_ok {
        eprintln!("[ws_server] rejected client {} — bad token", addr);
        return;
    }

    eprintln!("[ws_server] client connected: {}", addr);

    let mut rx = tx.subscribe();
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    loop {
        tokio::select! {
            // Forward broadcast messages to this client
            msg = rx.recv() => {
                match msg {
                    Ok(text) => {
                        if ws_sender.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break, // broadcast channel closed
                }
            }
            // Handle incoming messages from client (ping/pong, close)
            client_msg = ws_receiver.next() => {
                match client_msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        let _ = ws_sender.send(Message::Pong(data)).await;
                    }
                    _ => {} // ignore text/binary from client side for now
                }
            }
        }
    }

    eprintln!("[ws_server] client disconnected: {}", addr);
}

/// Count currently subscribed clients on the broadcast channel.
pub fn client_count(handle: &WsServerHandle) -> usize {
    handle.tx.receiver_count()
}
