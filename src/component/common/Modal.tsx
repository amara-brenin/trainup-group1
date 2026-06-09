import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import type { ModalProps } from "../../constant/interfaces";
import { decreaseModalCount, increaseModalCount } from "../../redux/themeSlice";

const sizeMap = {
  sm: "modal-sm",
  md: "",
  lg: "modal-lg",
  xl: "modal-xl",
};

export const Modal = ({
  show,
  title,
  onClose,
  children,
  size = "md",
  centered = false,
  scrollable = false,
  dialogClassName = "",
  contentClassName = "",
  bodyClassName = "",
  headerActions,
}: ModalProps) => {
  const outerClick = useRef(true);
  const counted = useRef(false);
  const dispatch = useAppDispatch();
  const { modalCount } = useAppSelector((state) => state.theme);

  useEffect(() => {
    if (show && !counted.current) {
      dispatch(increaseModalCount());
      counted.current = true;
    } else if (!show && counted.current) {
      dispatch(decreaseModalCount());
      counted.current = false;
    }

    return () => {
      if (counted.current) {
        dispatch(decreaseModalCount());
        counted.current = false;
      }
    };
  }, [dispatch, show]);

  useEffect(() => {
    if (modalCount > 0) {
      document.body.classList.add("modal-open", "overflow-hidden");
    } else {
      document.body.classList.remove("modal-open", "overflow-hidden");
      document.body.style.overflow = "auto";
    }
  }, [modalCount]);

  useEffect(() => {
    if (!show) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, show]);

  return (
    <div
      className={`modal fade ${show ? "show" : ""}`}
      tabIndex={-1}
      aria-labelledby="modalLabel"
      style={{ display: show ? "block" : "none" }}
      aria-modal="true"
      role="dialog"
      onClick={() => {
        window.setTimeout(() => {
          if (outerClick.current) {
            onClose();
          }
          outerClick.current = true;
        }, 50);
      }}
    >
      <div
        className={`modal-dialog ${sizeMap[size]} ${centered ? "modal-dialog-centered" : ""} ${
          scrollable ? "modal-dialog-scrollable" : ""
        } ${dialogClassName}`.trim()}
      >
        <div
          className={`modal-content ${contentClassName}`.trim()}
          onClick={(event) => {
            outerClick.current = false;
            event.stopPropagation();
          }}
        >
          <div className="modal-header py-2">
            <div>
              <h5 className="modal-title text-capitalize" id="modalLabel">
                {title}
              </h5>
            </div>
            <div className="d-flex align-items-center gap-2">
              {headerActions}
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
          </div>
          <div className={`modal-body ${bodyClassName}`.trim()}>{children}</div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
