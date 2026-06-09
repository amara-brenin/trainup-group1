import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { AllowedKeys, PermissionKeys } from "../../constant/permissions";
import type { NotificationPayload, NotificationRecord } from "../../constant/interfaces";
import { getScopedAppPath } from "../../helper/appShell";
import AxiosHelper from "../../helper/AxiosHelper";
import { setUnreadNotifications } from "../../redux/authSlice";

const severityClassMap: Record<string, string> = {
  success: "text-bg-success",
  warning: "text-bg-warning",
  error: "text-bg-danger",
  info: "text-bg-primary",
};

const formatRelativeTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000));

  if (diffMinutes < 1) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
};

const NotificationMenu = ({ buttonClassName = "nav-link dropdown-toggle arrow-none border-0 bg-transparent" }: { buttonClassName?: string }) => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const admin = useAppSelector((state) => state.admin);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<NotificationPayload>({
    unreadCount: 0,
    notifications: [],
  });
  const canViewNotifications =
    admin.role === "super_admin" ||
    (admin.allowed.includes(AllowedKeys.notifications) && admin.permission.includes(PermissionKeys.notificationsView));

  const hasUnread = useMemo(
    () => data.unreadCount > 0 || admin.isUnreadNotifications,
    [admin.isUnreadNotifications, data.unreadCount],
  );

  const syncNotifications = useCallback(async () => {
    if (!admin._id || !canViewNotifications) {
      return;
    }

    setLoading(true);
    const response = await AxiosHelper.getData<NotificationPayload>("/notifications", { limit: 10 });
    setLoading(false);

    if (!response.data.status) {
      return;
    }

    setData(response.data.data);
    dispatch(setUnreadNotifications(response.data.data.unreadCount > 0));
  }, [admin._id, canViewNotifications, dispatch]);

  useEffect(() => {
    void syncNotifications();
  }, [syncNotifications]);

  useEffect(() => {
    if (!admin._id || !canViewNotifications) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void syncNotifications();
    }, 30000);

    return () => window.clearInterval(timer);
  }, [admin._id, canViewNotifications, syncNotifications]);

  if (!canViewNotifications) {
    return null;
  }

  const markAllRead = async () => {
    const response = await AxiosHelper.postData<NotificationPayload>("/notifications/read-all", { limit: 10 });
    if (!response.data.status) {
      return;
    }

    setData(response.data.data);
    dispatch(setUnreadNotifications(false));
  };

  const markSingleRead = async (item: NotificationRecord) => {
    if (item.isRead) {
      return;
    }

    const response = await AxiosHelper.postData<NotificationPayload>("/notifications/read", {
      ids: [item.id],
      limit: 10,
    });

    if (!response.data.status) {
      return;
    }

    setData(response.data.data);
    dispatch(setUnreadNotifications(response.data.data.unreadCount > 0));
  };

  const handleOpen = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      void syncNotifications();
    }
  };

  return (
    <li className="dropdown notification-list">
      <button
        type="button"
        className={`${buttonClassName} ${open ? "show" : ""}`.trim()}
        onClick={handleOpen}
        aria-expanded={open}
        aria-label="Open notifications"
      >
        <i className="ri-notification-3-line fs-22" />
        {hasUnread ? <span className="noti-icon-badge" /> : null}
      </button>

      <div
        className={`dropdown-menu dropdown-menu-end dropdown-menu-animated p-0 ${open ? "show" : ""}`}
        style={{ width: 360, maxWidth: "calc(100vw - 24px)" }}
      >
        <div className="p-3 border-bottom d-flex align-items-center justify-content-between gap-2">
          <div>
            <div className="fw-semibold">Notifications</div>
            <div className="small text-body-secondary">
              {data.unreadCount > 0 ? `${data.unreadCount} unread updates` : "You're all caught up"}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-link text-decoration-none"
            onClick={() => void markAllRead()}
            disabled={!data.unreadCount}
          >
            Mark all read
          </button>
        </div>

        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {loading ? (
            <div className="p-3 small text-body-secondary">Loading notifications...</div>
          ) : data.notifications.length ? (
            data.notifications.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`dropdown-item p-3 border-bottom text-wrap ${!item.isRead ? "bg-light-subtle" : ""}`}
                onClick={() => {
                  void markSingleRead(item);
                  setOpen(false);
                  if (item.link) {
                    navigate(getScopedAppPath(item.link, admin.role));
                  }
                }}
              >
                <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
                  <span className={`badge ${severityClassMap[item.severity] || "text-bg-secondary"}`}>
                    {item.category}
                  </span>
                  <span className="small text-body-secondary">{formatRelativeTime(item.createdAt)}</span>
                </div>
                <div className="fw-semibold mb-1">{item.title}</div>
                <div className="small text-body-secondary">{item.message}</div>
                {item.actorName ? (
                  <div className="small text-body-secondary mt-2">By {item.actorName}</div>
                ) : null}
              </button>
            ))
          ) : (
            <div className="p-3 small text-body-secondary">No important notifications yet.</div>
          )}
        </div>
      </div>
    </li>
  );
};

export default NotificationMenu;
