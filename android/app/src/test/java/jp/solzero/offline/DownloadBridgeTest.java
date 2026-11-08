package jp.solzero.offline;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

public final class DownloadBridgeTest {
    @Test public void validJapaneseFilenamePreserved() {
        assertEquals("作品_02.zip", DownloadBridge.safeName("作品_02.zip"));
    }
    @Test public void traversalAndUnsafeNamesRejectedOrSanitized() {
        assertNull(DownloadBridge.safeName("../secret.txt"));
        assertNull(DownloadBridge.safeName("."));
        assertNull(DownloadBridge.safeName(".."));
        assertEquals("a_b.txt", DownloadBridge.safeName("a/b.txt"));
        assertEquals("a_b.txt", DownloadBridge.safeName("a\\b.txt"));
    }
    @Test public void emptyOrVeryLongNamesRejected() {
        assertNull(DownloadBridge.safeName("  "));
        assertNull(DownloadBridge.safeName("x".repeat(121)));
        assertNull(DownloadBridge.safeName(null));
    }
    @Test public void downloadHookInterceptsBlobWithoutNetwork() {
        assertTrue(NativeDownloadScript.CODE.contains("a.href.startsWith('blob:')"));
        assertTrue(NativeDownloadScript.CODE.contains("native.append("));
        assertTrue(NativeDownloadScript.CODE.contains("native.finish("));
    }
}
