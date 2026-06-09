import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type ActionDropdownProps = {
  label?: string;
  children: (helpers: { close: () => void }) => ReactNode;
};

const ActionDropdown = ({
  label = "Open row actions",
  children,
}: ActionDropdownProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const updatePosition = () => {
    const button = buttonRef.current;
    const menu = menuRef.current;

    if (!button || !menu) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gutter = 8;

    let left = rect.right - menuWidth;
    if (left < gutter) {
      left = gutter;
    }
    if (left + menuWidth > viewportWidth - gutter) {
      left = viewportWidth - menuWidth - gutter;
    }

    let top = rect.bottom + gutter;
    if (top + menuHeight > viewportHeight - gutter) {
      top = rect.top - menuHeight - gutter;
    }
    if (top < gutter) {
      top = gutter;
    }

    setMenuStyle({
      position: "fixed",
      top,
      left,
      zIndex: 1085,
    });
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);

      if (!insideTrigger && !insideMenu) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    updatePosition();

    const syncPosition = () => updatePosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="dropdown d-inline-block text-start">
      <button
        ref={buttonRef}
        type="button"
        className={`btn action-dropdown-toggle ${open ? "show" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
        aria-expanded={open}
      >
        <i className="bi bi-list-ul" aria-hidden="true" />
        <i className="bi bi-chevron-down action-dropdown-chevron" aria-hidden="true" />
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="dropdown-menu dropdown-menu-end action-dropdown-menu show"
              style={menuStyle}
            >
              {children({ close: () => setOpen(false) })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default ActionDropdown;
