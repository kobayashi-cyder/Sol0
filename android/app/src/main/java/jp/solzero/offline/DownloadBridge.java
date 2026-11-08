package jp.solzero.offline;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import java.io.OutputStream;
import java.io.IOException;

/** Save only explicit user-initiated Blob downloads, inside scoped Downloads.
 * No storage or network permission is required on Android 10+.
 * A failed or incomplete transfer is deleted before it becomes visible.
 */
public final class DownloadBridge {
    private static final long MAX_BYTES = 80L * 1024L * 1024L;
    private final Activity activity;
    private final ContentResolver resolver;
    private Uri uri;
    private OutputStream stream;
    private String activeId;
    private long expectedBytes, receivedBytes;

    public DownloadBridge(Activity activity) {
        this.activity = activity;
        resolver = activity.getContentResolver();
    }

    static String safeName(String name) {
        if (name == null) return null;
        String original = name.trim();
        if (original.isEmpty() || original.length() > 120) return null;
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < original.length(); i++) {
            char c = original.charAt(i);
            if (c < 32 || c == 127 || c == '/' || c == '\\'
                    || c == ':' || c == '*' || c == '?' || c == '"'
                    || c == '<' || c == '>' || c == '|') out.append('_');
            else out.append(c);
        }
        String normalized = out.toString();
        if (normalized.equals(".") || normalized.equals("..")
                || normalized.startsWith(".")) return null;
        return normalized;
    }

    private static boolean safeId(String id) {
        return id != null && id.matches("[a-zA-Z0-9_-]{1,50}");
    }

    private static String safeMime(String mime) {
        if (mime == null || mime.length() > 100
                || !mime.matches("[a-zA-Z0-9/;=+._ -]{1,100}")) return "application/octet-stream";
        return mime;
    }

    @JavascriptInterface
    public synchronized boolean begin(String id, String name, String mime, long size) {
        if (stream != null || !safeId(id) || safeName(name) == null
                || size < 0 || size > MAX_BYTES) return false;
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName(name));
            values.put(MediaStore.MediaColumns.MIME_TYPE, safeMime(mime));
            values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                    Environment.DIRECTORY_DOWNLOADS + "/SolZero");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return false;
            stream = resolver.openOutputStream(uri, "w");
            if (stream == null) { abort(); return false; }
            activeId = id;
            expectedBytes = size;
            receivedBytes = 0;
            return true;
        } catch (Exception ex) {
            abort();
            return false;
        }
    }

    @JavascriptInterface
    public synchronized boolean append(String id, String part) {
        if (!safeId(id) || !id.equals(activeId) || stream == null
                || part == null || part.length() > 120_000) return false;
        try {
            byte[] decoded = Base64.decode(part, Base64.DEFAULT);
            if (decoded.length > 65_536 || receivedBytes + decoded.length > expectedBytes) {
                abort();
                return false;
            }
            stream.write(decoded);
            receivedBytes += decoded.length;
            return true;
        } catch (Exception ex) {
            abort();
            return false;
        }
    }

    @JavascriptInterface
    public synchronized boolean finish(String id) {
        if (!safeId(id) || !id.equals(activeId) || stream == null
                || receivedBytes != expectedBytes) { abort(); return false; }
        try {
            stream.flush();
            stream.close();
            stream = null;
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(uri, done, null, null) < 1) {
                abort();
                return false;
            }
            uri = null;
            activeId = null;
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "Downloads/SolZero に保存しました", Toast.LENGTH_SHORT).show());
            return true;
        } catch (Exception ex) {
            abort();
            return false;
        }
    }

    @JavascriptInterface
    public synchronized void cancel(String id) {
        if (id != null && id.equals(activeId)) abort();
    }

    private void abort() {
        try { if (stream != null) stream.close(); } catch (IOException ignored) {}
        stream = null;
        if (uri != null) {
            try { resolver.delete(uri, null, null); } catch (Exception ignored) {}
        }
        uri = null;
        activeId = null;
        receivedBytes = 0;
        expectedBytes = 0;
    }
}
