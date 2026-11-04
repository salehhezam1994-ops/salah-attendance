package com.salah.attendance;

import android.app.Activity;
import android.content.Intent;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.os.Bundle;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** قراءة الرقم التسلسلي لبطاقات NFC بشكل متواصل (Reader Mode) */
@CapacitorPlugin(name = "NfcReader")
public class NfcReaderPlugin extends Plugin {
    private boolean reading = false;

    private NfcAdapter adapter() {
        return NfcAdapter.getDefaultAdapter(getContext());
    }

    @PluginMethod
    public void status(PluginCall call) {
        NfcAdapter a = adapter();
        JSObject r = new JSObject();
        r.put("supported", a != null);
        r.put("enabled", a != null && a.isEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        NfcAdapter a = adapter();
        if (a == null) {
            call.reject("NFC not supported", "UNSUPPORTED");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("NFC disabled", "DISABLED");
            return;
        }
        reading = true;
        enable();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        reading = false;
        disable();
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NFC_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private void enable() {
        final Activity act = getActivity();
        final NfcAdapter a = adapter();
        if (act == null || a == null) return;
        act.runOnUiThread(() -> {
            Bundle opts = new Bundle();
            opts.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 300);
            int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F
                    | NfcAdapter.FLAG_READER_NFC_V | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
                    | NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;
            a.enableReaderMode(act, this::onTag, flags, opts);
        });
    }

    private void disable() {
        final Activity act = getActivity();
        final NfcAdapter a = adapter();
        if (act == null || a == null) return;
        act.runOnUiThread(() -> {
            try {
                a.disableReaderMode(act);
            } catch (Exception ignored) {
            }
        });
    }

    private void onTag(Tag tag) {
        byte[] id = tag.getId();
        StringBuilder sb = new StringBuilder();
        if (id != null) for (byte b : id) sb.append(String.format("%02X", b));
        JSObject r = new JSObject();
        r.put("id", sb.toString());
        notifyListeners("tag", r);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (reading) enable();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (reading) disable();
    }
}
