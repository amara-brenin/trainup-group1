export const safeImport = async <T>(importer: () => Promise<T>): Promise<T> => {
  try {
    return await importer();
  } catch (error) {
    const key = "trainup-safe-import-reload";
    const hasRetried = window.sessionStorage.getItem(key);

    if (!hasRetried) {
      window.sessionStorage.setItem(key, "1");
      window.location.reload();
    }

    throw error;
  } finally {
    window.sessionStorage.removeItem("trainup-safe-import-reload");
  }
};
