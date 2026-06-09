import { useAppSelector } from "../../app/hooks";

export const Footer = () => {
  const settings = useAppSelector((state) => state.settings);

  return (
    <div className="footer">
      <div className="container-fluid">
        <div className="row">
          <div className="col-md-6 text-center text-md-start">{settings.copyright}</div>
          <div className="col-md-6">
            <div className="text-center text-md-end footer-links">
              <span className="fw-semibold">{settings.application_name}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Footer;
