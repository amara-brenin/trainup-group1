import QRCode from "qrcode";

// Generate a PNG data URL for a QR code. Used on the hall screen so trainees can
// scan to reach the join/waiting room.
export const generateQrDataUrl = async (text: string, size = 240): Promise<string> => {
  try {
    return await QRCode.toDataURL(text, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  } catch (_error) {
    return "";
  }
};
