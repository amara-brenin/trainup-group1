import type { ImgHTMLAttributes, SyntheticEvent } from "react";
import FallbackImage from "../../assets/images/favicon.png";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  title?: string;
};

const Image = (props: ImageProps) => {
  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.src = FallbackImage;
    event.currentTarget.onerror = null;
  };

  return <img {...props} onError={handleError} />;
};

export default Image;
