import { useCallback, useEffect, useState } from "react";
import PageShell from "../../component/common/PageShell";
import AxiosHelper from "../../helper/AxiosHelper";

type ApiAvatarItem = {
  _id: string;
  avatarId: string;
  avatarName: string;
  avatarType: string;
  avatarEngine: string;
  image?: string;
  isShared?: boolean;
};

const Avatars = () => {
  const [avatars, setAvatars] = useState<ApiAvatarItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAvatars = useCallback(async () => {
    setLoading(true);
    try {
      const { data: response } = await AxiosHelper.getData<{ data: ApiAvatarItem[] }>("/avatars");
      if (response.status && Array.isArray(response.data)) {
        setAvatars(response.data);
      }
    } catch (err) {
      console.error("Failed to fetch avatars", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAvatars();
  }, [fetchAvatars]);

  return (
    <PageShell title="Avatar Management" description="View available avatars on the platform.">
      {loading ? (
        <div className="d-flex justify-content-center p-5">
          <div className="spinner-border text-primary" role="status"></div>
        </div>
      ) : (
        <div className="row row-cols-1 row-cols-sm-2 row-cols-md-3 row-cols-lg-4 row-cols-xl-5 g-4 mt-1">
          {avatars.map((avatar) => (
            <div className="col" key={avatar.avatarId}>
              <div className="card h-100 shadow-sm border" style={{ borderRadius: "12px", position: "relative", overflow: "hidden" }}>
                <div className="card-body text-center p-3 d-flex flex-column align-items-center bg-white">
                  <div 
                    style={{ 
                      width: "100%", 
                      height: "150px", 
                      marginBottom: "1rem",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: avatar.image ? "transparent" : "#f8f9fa",
                      borderRadius: "8px"
                    }}
                  >
                    {avatar.image ? (
                      <img 
                        src={avatar.image} 
                        alt={avatar.avatarName} 
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} 
                      />
                    ) : (
                      <div className="text-muted opacity-50">
                        <svg width="48" height="48" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/>
                          <path fillRule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  
                  <h6 className="mb-1 fw-bold text-truncate w-100" title={avatar.avatarName}>{avatar.avatarName}</h6>
                  <div className="text-muted small mb-2" style={{ fontSize: "0.75rem" }}>{avatar.avatarId}</div>
                  
                  <span className="badge rounded-pill bg-light text-primary border px-2 py-1" style={{ fontSize: "0.65rem", fontWeight: "600" }}>
                    provider-TL
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
};

export default Avatars;
