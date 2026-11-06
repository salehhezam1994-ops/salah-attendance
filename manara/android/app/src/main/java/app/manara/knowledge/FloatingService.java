package app.manara.knowledge;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.app.NotificationCompat;

/**
 * The floating companion: a small draggable bubble that expands into a
 * movable, resizable panel showing the Manara companion page. It runs as a
 * foreground service (visible notification with a "close" action) and pauses
 * the web view whenever the panel is collapsed, to keep resource use low.
 */
public class FloatingService extends Service {
    public static final String EXTRA_URL = "url";
    public static final String ACTION_STOP = "app.manara.knowledge.STOP_FLOATING";
    public static volatile boolean running = false;

    private static final String CHANNEL_ID = "manara_floating";
    private static final int NOTIFICATION_ID = 7301;

    private WindowManager wm;
    private FrameLayout bubble;
    private WindowManager.LayoutParams bubbleLp;
    private LinearLayout panel;
    private WindowManager.LayoutParams panelLp;
    private WebView web;
    private boolean expanded = false;
    private String lastUrl;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wm == null) createViews();
        running = true;
        String url = intent != null ? intent.getStringExtra(EXTRA_URL) : null;
        if (url != null && ManaraLinks.sameOrigin(this, url)) {
            lastUrl = url;
            web.loadUrl(url);
            expand();
        }
        return START_NOT_STICKY;
    }

    /* ------------------------------ Foreground notification ------------------------------ */

    private void startInForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, getString(R.string.floating_channel), NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent stop = new Intent(this, FloatingService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stop, piFlags);
        PendingIntent openPi = PendingIntent.getActivity(this, 2, new Intent(this, MainActivity.class), piFlags);
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_manara)
            .setContentTitle(getString(R.string.floating_title))
            .setContentText(getString(R.string.floating_text))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openPi)
            .addAction(0, getString(R.string.floating_close), stopPi)
            .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION_ID, n);
    }

    /* ------------------------------ Views ------------------------------ */

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private int overlayType() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences("manara_floating", MODE_PRIVATE);
    }

    @SuppressLint({ "SetJavaScriptEnabled", "ClickableViewAccessibility" })
    private void createViews() {
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int primary = Color.parseColor("#1F6F66");

        // Bubble
        bubble = new FrameLayout(this);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(primary);
        bubble.setBackground(circle);
        bubble.setElevation(dp(6));
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher_round);
        int pad = dp(6);
        icon.setPadding(pad, pad, pad, pad);
        bubble.addView(icon, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        bubble.setContentDescription(getString(R.string.floating_title));
        bubbleLp = new WindowManager.LayoutParams(dp(56), dp(56), overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        bubbleLp.gravity = Gravity.TOP | Gravity.LEFT;
        bubbleLp.x = prefs().getInt("bx", dm.widthPixels - dp(72));
        bubbleLp.y = prefs().getInt("by", dm.heightPixels / 3);
        bubble.setOnTouchListener(new DragTouch(bubbleLp, bubble, true));

        // Panel
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#FBF8F1"));
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(1), Color.parseColor("#E6DFCF"));
        panel.setBackground(bg);
        panel.setClipToOutline(true);
        panel.setElevation(dp(10));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setBackgroundColor(primary);
        header.setPadding(dp(12), 0, dp(4), 0);
        TextView title = new TextView(this);
        title.setText(R.string.floating_title);
        title.setTextColor(Color.WHITE);
        title.setTextSize(15);
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        header.addView(headerButton("–", R.string.floating_minimize, v -> collapse()));
        header.addView(headerButton("✕", R.string.floating_close, v -> stopSelf()));
        panel.addView(header, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(44)));

        web = new WebView(this);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (ManaraLinks.sameOrigin(FloatingService.this, u.toString())) return false;
                // External links (e.g. a cited source) open in the browser.
                Intent i = new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(i);
                } catch (Exception ignored) {
                    // no browser available
                }
                collapse();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // The floating window never uses the camera or microphone.
                request.deny();
            }
        });
        web.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_DOWN) setPanelFocusable(true);
            return false;
        });
        panel.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // Resize grip (bottom edge, end side)
        FrameLayout footer = new FrameLayout(this);
        View grip = new View(this);
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.parseColor("#B8913A"));
        g.setCornerRadius(dp(3));
        grip.setBackground(g);
        grip.setContentDescription(getString(R.string.floating_resize));
        FrameLayout.LayoutParams gripLp = new FrameLayout.LayoutParams(dp(36), dp(6), Gravity.CENTER);
        footer.addView(grip, gripLp);
        footer.setOnTouchListener(new ResizeTouch());
        panel.addView(footer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(22)));

        int w = clamp(prefs().getInt("pw", dp(330)), dp(260), dm.widthPixels - dp(16));
        int h = clamp(prefs().getInt("ph", dp(460)), dp(320), dm.heightPixels - dp(80));
        panelLp = new WindowManager.LayoutParams(w, h, overlayType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH, PixelFormat.TRANSLUCENT);
        panelLp.gravity = Gravity.TOP | Gravity.LEFT;
        panelLp.x = clamp(prefs().getInt("px", (dm.widthPixels - w) / 2), 0, Math.max(0, dm.widthPixels - w));
        panelLp.y = clamp(prefs().getInt("py", dm.heightPixels / 6), 0, Math.max(0, dm.heightPixels - h));
        panelLp.softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE;
        header.setOnTouchListener(new DragTouch(panelLp, panel, false));
        // Touching outside the panel hands keyboard focus back to the app underneath.
        panel.setOnTouchListener((v, e) -> {
            if (e.getAction() == MotionEvent.ACTION_OUTSIDE) setPanelFocusable(false);
            return false;
        });

        wm.addView(bubble, bubbleLp);
    }

    private TextView headerButton(String label, int descRes, View.OnClickListener l) {
        TextView b = new TextView(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(18);
        b.setGravity(Gravity.CENTER);
        b.setContentDescription(getString(descRes));
        b.setOnClickListener(l);
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(40), dp(40)));
        return b;
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private void setPanelFocusable(boolean focusable) {
        if (panel == null || panel.getParent() == null) return;
        int f = panelLp.flags;
        int nf = focusable ? (f & ~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) : (f | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE);
        if (nf != f) {
            panelLp.flags = nf;
            wm.updateViewLayout(panel, panelLp);
        }
    }

    private void expand() {
        if (expanded) return;
        expanded = true;
        if (bubble.getParent() != null) wm.removeView(bubble);
        if (panel.getParent() == null) wm.addView(panel, panelLp);
        web.onResume();
        web.resumeTimers();
        if (web.getUrl() == null && lastUrl != null) web.loadUrl(lastUrl);
    }

    private void collapse() {
        if (!expanded) return;
        expanded = false;
        setPanelFocusable(false);
        if (panel.getParent() != null) wm.removeView(panel);
        if (bubble.getParent() == null) wm.addView(bubble, bubbleLp);
        web.onPause();
        web.pauseTimers();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (wm != null) {
            if (bubble != null && bubble.getParent() != null) wm.removeView(bubble);
            if (panel != null && panel.getParent() != null) wm.removeView(panel);
        }
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }

    /* ------------------------------ Touch handling ------------------------------ */

    /** Drags a window; for the bubble, a tap (no movement) expands the panel and release snaps to the nearest edge. */
    private class DragTouch implements View.OnTouchListener {
        private final WindowManager.LayoutParams lp;
        private final View view;
        private final boolean isBubble;
        private int startX, startY;
        private float downX, downY;
        private boolean moved;

        DragTouch(WindowManager.LayoutParams lp, View view, boolean isBubble) {
            this.lp = lp;
            this.view = view;
            this.isBubble = isBubble;
        }

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startX = lp.x;
                    startY = lp.y;
                    downX = e.getRawX();
                    downY = e.getRawY();
                    moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    int dx = Math.round(e.getRawX() - downX);
                    int dy = Math.round(e.getRawY() - downY);
                    if (Math.abs(dx) + Math.abs(dy) > dp(6)) moved = true;
                    if (moved) {
                        DisplayMetrics dm = getResources().getDisplayMetrics();
                        lp.x = clamp(startX + dx, 0, Math.max(0, dm.widthPixels - lp.width));
                        lp.y = clamp(startY + dy, 0, Math.max(0, dm.heightPixels - lp.height));
                        wm.updateViewLayout(view, lp);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (isBubble) {
                        if (!moved) {
                            expand();
                            return true;
                        }
                        DisplayMetrics dm = getResources().getDisplayMetrics();
                        lp.x = lp.x + lp.width / 2 < dm.widthPixels / 2 ? dp(8) : dm.widthPixels - lp.width - dp(8);
                        wm.updateViewLayout(view, lp);
                        prefs().edit().putInt("bx", lp.x).putInt("by", lp.y).apply();
                    } else if (moved) {
                        prefs().edit().putInt("px", lp.x).putInt("py", lp.y).apply();
                    }
                    return true;
                default:
                    return false;
            }
        }
    }

    /** Resizes the panel within screen bounds. */
    private class ResizeTouch implements View.OnTouchListener {
        private int startW, startH;
        private float downX, downY;

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            DisplayMetrics dm = getResources().getDisplayMetrics();
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startW = panelLp.width;
                    startH = panelLp.height;
                    downX = e.getRawX();
                    downY = e.getRawY();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    int dx = Math.round(e.getRawX() - downX);
                    panelLp.width = clamp(startW + dx, dp(260), dm.widthPixels - panelLp.x);
                    panelLp.height = clamp(startH + Math.round(e.getRawY() - downY), dp(320), dm.heightPixels - panelLp.y);
                    wm.updateViewLayout(panel, panelLp);
                    return true;
                case MotionEvent.ACTION_UP:
                    prefs().edit().putInt("pw", panelLp.width).putInt("ph", panelLp.height).apply();
                    return true;
                default:
                    return false;
            }
        }
    }
}
