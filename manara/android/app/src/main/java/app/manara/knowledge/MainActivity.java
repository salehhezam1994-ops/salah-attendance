package app.manara.knowledge;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FloatingCompanionPlugin.class);
        super.onCreate(savedInstanceState);
        // Remember the server origin so the floating window and the "Ask Manara"
        // text-selection action can open companion pages without the main screen.
        ManaraLinks.saveOrigin(this, getBridge().getAppUrl());
        handleShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShare(intent);
    }

    /** "Share to Manara" from another app: only the text the user explicitly shared is passed on. */
    private void handleShare(Intent intent) {
        String text = ManaraLinks.sharedText(intent);
        if (text == null) return;
        String url = ManaraLinks.shareUrl(ManaraLinks.origin(this), text, false);
        if (url == null) return;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
        intent.setAction(null);
    }
}
