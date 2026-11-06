package app.manara.knowledge;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Floating companion window over other apps (Android only).
 * Uses the "display over other apps" permission, which the user grants
 * explicitly in system settings. The window shows the Manara companion page;
 * it never reads or captures the content of other apps.
 */
@CapacitorPlugin(name = "FloatingCompanion")
public class FloatingCompanionPlugin extends Plugin {

    private boolean canDraw() {
        return Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", true);
        r.put("permission", canDraw());
        r.put("running", FloatingService.running);
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (canDraw()) {
            resolvePermission(call);
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "overlayPermissionResult");
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        resolvePermission(call);
    }

    private void resolvePermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("permission", canDraw());
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !ManaraLinks.sameOrigin(getContext(), url)) {
            call.reject("The floating window can only open Manara pages", "BAD_URL");
            return;
        }
        if (!canDraw()) {
            call.reject("Overlay permission not granted", "NO_PERMISSION");
            return;
        }
        Intent i = new Intent(getContext(), FloatingService.class);
        i.putExtra(FloatingService.EXTRA_URL, url);
        ContextCompat.startForegroundService(getContext(), i);
        // Step aside so the user returns to whatever they were reading or watching.
        if (call.getBoolean("minimizeApp", true)) {
            getActivity().runOnUiThread(() -> getActivity().moveTaskToBack(true));
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent i = new Intent(getContext(), FloatingService.class);
        i.setAction(FloatingService.ACTION_STOP);
        getContext().startService(i);
        call.resolve();
    }
}
