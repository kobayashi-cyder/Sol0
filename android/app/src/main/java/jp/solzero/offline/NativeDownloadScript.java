package jp.solzero.offline;

/** Intercepts app-created Blob anchors; streams bounded chunks to MediaStore.
 * Files can be saved without enabling unsafe file:// access or INTERNET.
 */
public final class NativeDownloadScript {
    private NativeDownloadScript() {}

    public static final String CODE = """
        (() => {
          if (window.__solZeroDownloadsReady || !window.SolZeroDownloads) return;
          window.__solZeroDownloadsReady = true;
          const native = window.SolZeroDownloads;
          document.addEventListener('click', (event) => {
            const a = event.target?.closest?.('a[download]');
            if (!a || !a.href.startsWith('blob:')) return;
            event.preventDefault();
            event.stopPropagation();
            const id = 'sz_' + Date.now().toString(36) + '_' +
              Math.random().toString(36).slice(2, 10);
            (async () => {
              const response = await fetch(a.href);
              const blob = await response.blob();
              const name = a.getAttribute('download') || 'solzero-export.bin';
              if (!native.begin(id, name, blob.type || 'application/octet-stream', blob.size)) {
                throw Error('Android cannot create the destination file');
              }
              for (let offset = 0; offset < blob.size; offset += 49152) {
                const fragment = blob.slice(offset, Math.min(offset + 49152, blob.size));
                const data = await new Promise((resolve, reject) => {
                  const r = new FileReader();
                  r.onload = () => resolve(r.result);
                  r.onerror = () => reject(Error('FileReader error'));
                  r.readAsDataURL(fragment);
                });
                const comma = data.indexOf(',');
                if (comma < 0 || !native.append(id, data.slice(comma + 1))) {
                  throw Error('Android download chunk rejected');
                }
              }
              if (!native.finish(id)) throw Error('Android file integrity check failed');
            })().catch(error => {
              native.cancel(id);
              console.error('SolZero offline export:', error.message);
              const toast = document.getElementById('toast');
              if (toast) {
                toast.textContent = 'ファイル保存に失敗：' + error.message;
                toast.classList.remove('hidden');
              }
            });
          }, true);
        })();
        """;
}
