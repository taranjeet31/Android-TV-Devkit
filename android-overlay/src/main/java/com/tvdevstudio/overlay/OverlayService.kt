package com.tvdevstudio.overlay

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.os.IBinder
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import org.json.JSONObject
import java.net.URI
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake

class OverlayService : Service() {

    private lateinit var windowManager: WindowManager
    private lateinit var overlayView: OverlayView
    private var wsClient: WebSocketClient? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        overlayView = OverlayView(this)

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.TOP or Gravity.START
        windowManager.addView(overlayView, params)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val host = intent?.getStringExtra("host") ?: "127.0.0.1"
        val port = intent?.getIntExtra("port", 9877) ?: 9877
        val token = intent?.getStringExtra("token") ?: ""

        connectWebSocket(host, port, token)
        return START_STICKY
    }

    private fun connectWebSocket(host: String, port: Int, token: String) {
        wsClient?.close()
        val uri = URI("ws://$host:$port${if (token.isNotEmpty()) "?token=$token" else ""}")
        wsClient = object : WebSocketClient(uri) {
            override fun onOpen(handshakedata: ServerHandshake?) {
                overlayView.isCursorVisible = true
                overlayView.postInvalidate()
            }

            override fun onMessage(message: String?) {
                message?.let { parseAndRenderMessage(it) }
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                overlayView.isCursorVisible = false
                overlayView.postInvalidate()
            }

            override fun onError(ex: Exception?) {}
        }
        wsClient?.connect()
    }

    private fun parseAndRenderMessage(jsonStr: String) {
        try {
            val json = JSONObject(jsonStr)
            when (json.optString("type")) {
                "cursor_start" -> {
                    overlayView.isCursorVisible = true
                }
                "cursor_move" -> {
                    val dx = json.optInt("dx", 0)
                    val dy = json.optInt("dy", 0)
                    overlayView.moveCursor(dx, dy)
                }
                "move" -> {
                    val x = json.optInt("x", 0)
                    val y = json.optInt("y", 0)
                    overlayView.setCursorPos(x, y)
                }
                "cursor_down", "click" -> {
                    overlayView.pulse()
                }
                "cursor_end" -> {
                    overlayView.isCursorVisible = false
                }
                "draw_shape" -> {
                    val left = json.optInt("left", 0)
                    val top = json.optInt("top", 0)
                    val right = json.optInt("right", 0)
                    val bottom = json.optInt("bottom", 0)
                    overlayView.setHighlightBounds(left, top, right, bottom)
                }
            }
            overlayView.postInvalidate()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        wsClient?.close()
        if (::overlayView.isInitialized) {
            windowManager.removeView(overlayView)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

class OverlayView(context: Context) : View(context) {
    var cursorX = 960f
    var cursorY = 540f
    var isCursorVisible = true
    private var pulseScale = 1.0f

    private var highlightBounds: android.graphics.Rect? = null

    private val cursorPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#3B82F6")
        style = Paint.Style.FILL
    }

    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }

    private val highlightPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#10B981")
        style = Paint.Style.STROKE
        strokeWidth = 6f
    }

    fun moveCursor(dx: Int, dy: Int) {
        cursorX = (cursorX + dx).coerceIn(0f, width.toFloat())
        cursorY = (cursorY + dy).coerceIn(0f, height.toFloat())
    }

    fun setCursorPos(x: Int, y: Int) {
        cursorX = x.toFloat()
        cursorY = y.toFloat()
    }

    fun pulse() {
        pulseScale = 0.6f
        postDelayed({
            pulseScale = 1.0f
            invalidate()
        }, 150)
    }

    fun setHighlightBounds(left: Int, top: Int, right: Int, bottom: Int) {
        highlightBounds = android.graphics.Rect(left, top, right, bottom)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        highlightBounds?.let {
            canvas.drawRect(it, highlightPaint)
        }

        if (isCursorVisible) {
            val radius = 12f * pulseScale
            canvas.drawCircle(cursorX, cursorY, radius, cursorPaint)
            canvas.drawCircle(cursorX, cursorY, radius, strokePaint)
        }
    }
}
