import { Link, useLocation } from "react-router-dom";
import { adminMenu } from "../../constant/adminMenu";
import { superAdminMenu } from "../../constant/superAdminMenu";
import { stripSuperAdminPrefix } from "../../helper/appShell";
import { isObjectIdSegment, isUuidSegment, toTitleCase } from "../../helper/string";

const allMenus = [...adminMenu, ...superAdminMenu];
const labelEntries: Array<[string, string]> = allMenus.flatMap((item) => {
  const current = item.link ? [[item.link.replace("/", ""), item.label] as [string, string]] : [];
  const children =
    item.children?.flatMap((child) =>
      child.link ? [[child.link.replace("/", ""), child.label] as [string, string]] : [],
    ) ?? [];

  return [...current, ...children];
});

const labelMap = new Map<string, string>(labelEntries);

export const BreadCrumb = () => {
  const { pathname } = useLocation();
  const normalizedPath = stripSuperAdminPrefix(pathname);
  const basePrefix = pathname.startsWith("/super-admin") ? "/super-admin" : "";
  const segments = normalizedPath
    .split("/")
    .filter(Boolean)
    .filter((segment) => !isObjectIdSegment(segment) && !isUuidSegment(segment));

  if (segments.length === 0) {
    return null;
  }

  return (
    <div className="page-title-box admin-breadcrumb-shell">
      <ol className="breadcrumb admin-breadcrumb m-0">
        {normalizedPath !== "/dashboard" ? (
          <li className="breadcrumb-item">
            <Link to={`${basePrefix}/dashboard`}>Dashboard</Link>
          </li>
        ) : null}
        {segments.map((segment, index) => {
          const path = `${basePrefix}/${segments.slice(0, index + 1).join("/")}`;
          const label = labelMap.get(segment) ?? toTitleCase(segment);
          const isLast = index === segments.length - 1;

          return (
            <li key={path} className={`breadcrumb-item text-capitalize ${isLast ? "active" : ""}`} aria-current={isLast ? "page" : undefined}>
              {isLast ? label : <Link to={path}>{label}</Link>}
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export default BreadCrumb;
