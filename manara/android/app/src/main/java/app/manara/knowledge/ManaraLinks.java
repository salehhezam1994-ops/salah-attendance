package app.manara.knowledge;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;

/** Small helpers for building companion URLs on the Manara server. */
final class ManaraLinks {
    private static final String PREFS = "manara";
    private static final String KEY_ORIGIN = "origin";
    private static final int MAX_SHARED = 6000;

    private ManaraLinks() {}

    static void saveOrigin(Context ctx, String appUrl) {
        String origin = originOf(appUrl);
        if (origin != null) prefs(ctx).edit().putString(KEY_ORIGIN, origin).apply();
    }

    static String origin(Context ctx) {
        return prefs(ctx).getString(KEY_ORIGIN, null);
    }

    static String originOf(String url) {
        if (url == null) return null;
        Uri u = Uri.parse(url);
        if (u.getScheme() == null || u.getHost() == null) return null;
        return u.getScheme() + "://" + u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : "");
    }

    /** True when the URL points to the same origin as the Manara server. */
    static boolean sameOrigin(Context ctx, String url) {
        String o = origin(ctx);
        return o != null && o.equals(originOf(url));
    }

    static String shareUrl(String origin, String text, boolean mini) {
        if (origin == null || text == null) return null;
        String t = text.length() > MAX_SHARED ? text.substring(0, MAX_SHARED) : text;
        Uri.Builder b = Uri.parse(origin).buildUpon().path("/share").appendQueryParameter("text", t);
        if (mini) b.appendQueryParameter("mini", "1");
        return b.build().toString();
    }

    static String sharedText(Intent intent) {
        if (intent == null) return null;
        CharSequence cs = null;
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            cs = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            cs = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        }
        if (cs == null) return null;
        String s = cs.toString().trim();
        return s.isEmpty() ? null : s;
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
