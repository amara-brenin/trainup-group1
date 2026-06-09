const dataImagePattern = /^data:image\/[a-z0-9.+-]+;base64,/i;

const isHttpUrl = (value: string) => {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_error) {
    return false;
  }
};

export const isSupportedBrandAssetSource = (value: string) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return true;
  }

  return dataImagePattern.test(normalized) || isHttpUrl(normalized);
};

export const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });

export const validateBrandAssetSource = async (value: string, label: string) => {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  if (!isSupportedBrandAssetSource(normalized)) {
    return `Use a valid ${label.toLowerCase()} URL or choose a file from your device.`;
  }

  if (typeof window === "undefined" || dataImagePattern.test(normalized)) {
    return "";
  }

  return new Promise<string>((resolve) => {
    const image = new window.Image();
    const timer = window.setTimeout(() => {
      resolve(`${label} could not be loaded from this URL.`);
    }, 5000);

    image.onload = () => {
      window.clearTimeout(timer);
      resolve("");
    };

    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(`${label} could not be loaded from this URL.`);
    };

    image.src = normalized;
  });
};
