import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 767.98px)";

export const useMobile = () => {
  const getValue = () =>
    typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;

  const [isMobile, setIsMobile] = useState(getValue);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY);
    const handler = () => setIsMobile(mediaQuery.matches);

    handler();
    mediaQuery.addEventListener("change", handler);

    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return isMobile;
};
