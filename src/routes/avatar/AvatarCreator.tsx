import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import PageShell from "../../component/common/PageShell";
import type {
  AvatarAppearanceType,
  AvatarFoundationMode,
  AvatarProfile,
} from "../../constant/interfaces";
import { deleteAvatarProfile, saveAvatarProfile } from "../../redux/trainingWorkspaceSlice";

type AvatarCreatorTab = "appearance" | "environment" | "brain" | "advanced" | "embed";
type EnvironmentView = "background" | "3d_environment";
type BrainView = "foundation" | "knowledge_base" | "functions";
type EmbedView = "iframe" | "avatar_environment_json" | "client_json";

const avatarTabs: Array<{ key: AvatarCreatorTab; label: string; icon: string }> = [
  { key: "appearance", label: "Appearance", icon: "bi bi-emoji-smile" },
  { key: "environment", label: "Environment", icon: "bi bi-image" },
  { key: "brain", label: "Brain", icon: "bi bi-cpu" },
  { key: "advanced", label: "Advanced", icon: "bi bi-sliders" },
  { key: "embed", label: "Embed", icon: "bi bi-clipboard" },
];

const appearanceOptions: Array<{ value: AvatarAppearanceType; label: string; icon: string; help: string }> = [
  { value: "image", label: "Image Avatars", icon: "bi bi-camera-fill", help: "Still-image avatars with expressive speech delivery." },
  { value: "video", label: "Video Avatars", icon: "bi bi-camera-video-fill", help: "Recorded video-style avatars for realistic delivery." },
  { value: "upper_body_3d", label: "Upper Body 3D", icon: "bi bi-person-square", help: "3D torso avatars for presenter-style scenes." },
  { value: "full_body_3d", label: "Full Body 3D", icon: "bi bi-person-standing", help: "Full character avatars for stage or immersive scenes." },
];

const foundationModes: AvatarFoundationMode[] = ["Simple", "Composite", "Speech to Speech", "3rd Party AI"];
const environmentOptions = ["Corporate Studio", "Retail Floor", "Conference Hall"];
const environmentBackgroundLibrary = {
  image: [
    "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1517502884422-41eaead166d4?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366412874-3415097a27e7?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=80",
  ],
  video: [
    "https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366412874-3415097a27e7?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366858526-0766cadbe8fa?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366858526-0766cadbe8fa?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=900&q=80",
  ],
};

const buildNewAvatarProfile = (): AvatarProfile => ({
  id: `avatar-${Date.now()}`,
  name: "",
  project: "Shared Avatar Library",
  avatarPhoto: "",
  appearanceType: "image",
  backgroundType: "image",
  backgroundValue: "",
  environment3d: environmentOptions[0],
  foundationMode: "Composite",
  avatarEngine: "Large Language Model",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "",
  model: "llama-3.3-70b-versatile",
  prompt: "",
  memoryEnabled: true,
  maxMemoryTokens: "2048",
  sttProvider: "Trulience STT",
  contextPhrases: [],
  language: "en-IN",
  additionalLanguages: ["en-US"],
  ttsProvider: "ElevenLabs",
  ttsApiKey: "",
  ttsModel: "eleven_flash_v2_5",
  voiceName: "",
  knowledgeBaseItems: [],
  functions: [],
  advanced: {
    general: "",
    usageLimits: "",
    interruptions: "",
    vad: "",
    launchVisibility: "",
    styling: "",
  },
  embed: {
    iframe: "",
    avatarEnvironmentJson: "",
    clientJson: "",
  },
  lastUpdated: "",
  onlineUsers: 0,
});

const AvatarCreator = () => {
  const dispatch = useAppDispatch();
  const avatarProfiles = useAppSelector((state) => state.trainingWorkspace.avatarProfiles);
  const [search, setSearch] = useState("");
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(avatarProfiles[0]?.id ?? null);
  const [activeTab, setActiveTab] = useState<AvatarCreatorTab>("appearance");
  const [expandedAdvancedSection, setExpandedAdvancedSection] = useState<keyof AvatarProfile["advanced"]>("general");
  const [draft, setDraft] = useState<AvatarProfile | null>(null);
  const [editingField, setEditingField] = useState<"name" | "photo" | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [expandedAvatarId, setExpandedAvatarId] = useState<string | null>(avatarProfiles[0]?.id ?? null);
  const [environmentView, setEnvironmentView] = useState<EnvironmentView>("background");
  const [environmentSectionOpen, setEnvironmentSectionOpen] = useState(true);
  const [brainView, setBrainView] = useState<BrainView>("foundation");
  const [embedView, setEmbedView] = useState<EmbedView>("iframe");

  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return avatarProfiles;
    }

    return avatarProfiles.filter((profile) =>
      [profile.name, profile.project, profile.avatarEngine, profile.model].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [avatarProfiles, search]);

  const selectedProfile = useMemo(
    () => avatarProfiles.find((profile) => profile.id === selectedAvatarId) ?? null,
    [avatarProfiles, selectedAvatarId],
  );

  const appearanceLibrary = useMemo(
    () => avatarProfiles.filter((profile) => profile.appearanceType === draft?.appearanceType),
    [avatarProfiles, draft?.appearanceType],
  );

  useEffect(() => {
    if (!selectedAvatarId && avatarProfiles[0]?.id) {
      setSelectedAvatarId(avatarProfiles[0].id);
      setExpandedAvatarId(avatarProfiles[0].id);
      return;
    }

    if (selectedProfile) {
      setDraft(selectedProfile);
      return;
    }

    setDraft(buildNewAvatarProfile());
  }, [avatarProfiles, selectedAvatarId, selectedProfile]);

  const updateDraft = <K extends keyof AvatarProfile>(key: K, value: AvatarProfile[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const updateAdvanced = (key: keyof AvatarProfile["advanced"], value: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            advanced: {
              ...current.advanced,
              [key]: value,
            },
          }
        : current,
    );
  };

  const saveProfile = () => {
    if (!draft) {
      return;
    }

    if (!draft.name.trim()) {
      toast.error("Avatar name is required.");
      return;
    }

    if (!draft.project.trim()) {
      toast.error("Project name is required.");
      return;
    }

    dispatch(
      saveAvatarProfile({
        ...draft,
        name: draft.name.trim(),
        project: draft.project.trim(),
        contextPhrases: draft.contextPhrases.filter(Boolean),
        additionalLanguages: draft.additionalLanguages.filter(Boolean),
        knowledgeBaseItems: draft.knowledgeBaseItems.filter(Boolean),
        functions: draft.functions.filter((item) => item.name.trim()),
      }),
    );
    setSelectedAvatarId(draft.id);
    setExpandedAvatarId(draft.id);
    setIsEditMode(false);
    setEditingField(null);
    toast.success("Avatar profile saved.");
  };

  const createAvatar = () => {
    const next = buildNewAvatarProfile();
    setSelectedAvatarId(next.id);
    setExpandedAvatarId(next.id);
    setDraft(next);
    setActiveTab("appearance");
    setIsEditMode(true);
  };

  const finishInlineEdit = () => {
    setEditingField(null);
  };

  const closeEditMode = () => {
    setDraft(selectedProfile ?? buildNewAvatarProfile());
    setIsEditMode(false);
    setEditingField(null);
  };

  const deleteSelectedAvatar = () => {
    if (!draft?.id || !selectedProfile) {
      return;
    }

    dispatch(deleteAvatarProfile({ avatarId: draft.id }));
    const fallbackId = avatarProfiles.find((profile) => profile.id !== draft.id)?.id ?? null;
    setSelectedAvatarId(fallbackId);
    toast.success("Avatar profile deleted.");
  };

  const connectSelectedAvatar = async () => {
    if (!selectedProfile?.embed.iframe) {
      toast.error("Save the avatar first to generate embed code.");
      return;
    }

    await navigator.clipboard.writeText(selectedProfile.embed.iframe);
    toast.success("Embed iframe copied.");
  };

  const hasDraftChanges = useMemo(() => {
    if (!draft || !selectedProfile) {
      return false;
    }

    return JSON.stringify(draft) !== JSON.stringify(selectedProfile);
  }, [draft, selectedProfile]);

  const confirmDiscardChanges = () => {
    if (!isEditMode || !hasDraftChanges) {
      return true;
    }

    const shouldDiscard = window.confirm("You have unsaved changes. Click OK to discard them, or Cancel to keep editing.");
    if (shouldDiscard) {
      setDraft(selectedProfile ?? buildNewAvatarProfile());
      setIsEditMode(false);
      setEditingField(null);
    }
    return shouldDiscard;
  };

  const confirmSaveChanges = () => {
    if (!isEditMode || !hasDraftChanges) {
      saveProfile();
      return;
    }

    const shouldSave = window.confirm("Save changes to this avatar?");
    if (shouldSave) {
      saveProfile();
    }
  };

  if (!draft) {
    return null;
  }

  return (
    <PageShell
      title="Avatar Creator"
      description="Create and manage project-specific avatars that power training launch experiences and Step-1 avatar selection."
    >

      <div className="avatar-creator-shell">
        <aside className="avatar-creator-sidebar card">
          <div className="card-body">
            <h2 className="h4 fw-semibold mb-2">Avatar Creator</h2>
            <p className="text-body-secondary small mb-3">
              Create and manage interactive avatars, then reuse them across training projects, embeds, and admin flows.
            </p>
            <button type="button" className="btn btn-primary avatar-creator-start-btn mb-3" onClick={createAvatar}>
              Start
            </button>
            <input
              className="form-control mb-3"
              placeholder="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <div className="avatar-creator-list">
              {filteredProfiles.map((profile) => {
                const isSelected = profile.id === draft.id;

                return (
                  <div key={profile.id} className={`avatar-creator-list-card ${isSelected ? "is-selected" : ""}`}>
                    <button
                      type="button"
                      className="avatar-creator-list-trigger"
                      onClick={() => {
                        if (isSelected) {
                          setExpandedAvatarId((current) => (current === profile.id ? null : profile.id));
                          return;
                        }

                        if (!confirmDiscardChanges()) {
                          return;
                        }

                        setSelectedAvatarId(profile.id);
                        setExpandedAvatarId(profile.id);
                        setIsEditMode(false);
                        setEditingField(null);
                        setActiveTab("appearance");
                      }}
                    >
                      <span className="fw-semibold">{profile.name}</span>
                      <i className={`bi ${expandedAvatarId === profile.id ? "bi-chevron-up" : "bi-chevron-down"}`} />
                    </button>

                    {isSelected && expandedAvatarId === profile.id ? (
                      <div className="avatar-creator-list-details">
                        <div className="avatar-creator-list-meta">
                          <div>
                            <div className="small text-body-secondary">Avatar Name</div>
                            <div className="avatar-creator-inline-edit-row">
                              {isEditMode && editingField === "name" ? (
                                <input
                                  className="form-control form-control-sm"
                                  value={draft.name}
                                  onChange={(event) => updateDraft("name", event.target.value)}
                                  onBlur={finishInlineEdit}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      finishInlineEdit();
                                    }
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <>
                                  <span>{isEditMode ? draft.name || profile.name : profile.name}</span>
                                  {isEditMode ? (
                                    <button
                                      type="button"
                                  className="avatar-creator-inline-edit-btn"
                                  onClick={() => {
                                    setSelectedAvatarId(profile.id);
                                    setIsEditMode(true);
                                    setEditingField("name");
                                  }}
                                >
                                  <i className="bi bi-pencil" />
                                    </button>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="small text-body-secondary">Avatar Photo</div>
                            <div className="avatar-creator-inline-edit-row">
                              <div className="avatar-creator-list-photo">
                                {(isEditMode ? draft.avatarPhoto : profile.avatarPhoto) ? (
                                  <img src={(isEditMode ? draft.avatarPhoto : profile.avatarPhoto) || ""} alt={profile.name} />
                                ) : (
                                  <span>{profile.name.slice(0, 1).toUpperCase()}</span>
                                )}
                              </div>
                              {isEditMode ? (
                                <button
                                  type="button"
                                  className="avatar-creator-inline-edit-btn"
                                  onClick={() => {
                                    setActiveTab("appearance");
                                    setIsEditMode(true);
                                    setEditingField("photo");
                                  }}
                                >
                                  <i className="bi bi-pencil" />
                                </button>
                              ) : null}
                            </div>
                          </div>
                          <div>
                            <div className="small text-body-secondary">Avatar ID</div>
                            <div className="text-break">{profile.id}</div>
                          </div>
                          <div>
                            <div className="small text-body-secondary">Avatar Engine</div>
                            <div>{profile.avatarEngine}</div>
                          </div>
                          <div>
                            <div className="small text-body-secondary">Last Updated</div>
                            <div>{profile.lastUpdated}</div>
                          </div>
                          <div>
                            <div className="small text-body-secondary">Online Users</div>
                            <div>{profile.onlineUsers}</div>
                          </div>
                        </div>
                        <div className="avatar-creator-list-actions">
                          {isEditMode ? (
                            <>
                              <button type="button" className="btn btn-success btn-sm" onClick={confirmSaveChanges}>
                                Save
                              </button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                                if (confirmDiscardChanges()) {
                                  closeEditMode();
                                }
                              }}>
                                Close
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                setSelectedAvatarId(profile.id);
                                setExpandedAvatarId(profile.id);
                                setActiveTab("appearance");
                                setIsEditMode(true);
                                setEditingField(null);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={connectSelectedAvatar}>
                            Connect
                          </button>
                          <button type="button" className="btn btn-outline-danger btn-sm" onClick={deleteSelectedAvatar}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="avatar-creator-main card">
          <div className="card-body">
            <div className="avatar-creator-tabs">
              {avatarTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`avatar-creator-tab ${activeTab === tab.key ? "is-active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <i className={tab.icon} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>

            {activeTab === "appearance" ? (
              <div className="avatar-creator-stage">
                <div className="avatar-creator-stage-grid">
                  <div className={`avatar-creator-stage-main ${isEditMode ? "is-editing" : ""}`}>
                    <div className="avatar-creator-appearance-wall">
                      <div className="avatar-creator-appearance-switcher">
                        {appearanceOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`avatar-creator-appearance-column-head ${draft.appearanceType === option.value ? "is-selected" : ""}`}
                            onClick={() => updateDraft("appearanceType", option.value)}
                          >
                            <i className={option.icon} />
                            <span>{option.label}</span>
                          </button>
                        ))}
                      </div>

                      <div className="avatar-creator-appearance-cards avatar-creator-appearance-grid">
                        {appearanceLibrary.map((profile) => {
                          const isActiveCard = profile.id === draft.id;

                          return (
                            <button
                              key={profile.id}
                              type="button"
                              className={`avatar-creator-preview-tile ${isActiveCard ? "is-active" : ""}`}
                              onClick={() => {
                                if (!isEditMode) {
                                  return;
                                }

                                setSelectedAvatarId(profile.id);
                                updateDraft("appearanceType", profile.appearanceType);
                              }}
                              title={profile.name}
                            >
                              {profile.avatarPhoto ? (
                                <img src={profile.avatarPhoto} alt={profile.name} />
                              ) : (
                                <span>{profile.name.slice(0, 1).toUpperCase()}</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            ) : null}

            {activeTab === "environment" ? (
              <div className="avatar-creator-pane">
                <div className="avatar-creator-environment-shell">
                  <div className="avatar-creator-environment-topbar">
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${environmentView === "background" ? "is-selected" : ""}`}
                      onClick={() => setEnvironmentView("background")}
                    >
                      <i className="bi bi-image-fill" />
                      <span>Background</span>
                    </button>
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${environmentView === "3d_environment" ? "is-selected" : ""}`}
                      onClick={() => setEnvironmentView("3d_environment")}
                    >
                      <i className="bi bi-controller" />
                      <span>3D Environment</span>
                    </button>
                  </div>

                  <div className="avatar-creator-environment-card">
                    <button
                      type="button"
                      className="avatar-creator-environment-card-head"
                      onClick={() => setEnvironmentSectionOpen((current) => !current)}
                    >
                      <span>{environmentView === "background" ? "Background" : "3D Environment"}</span>
                      <i className={`bi ${environmentSectionOpen ? "bi-chevron-up" : "bi-chevron-down"}`} />
                    </button>

                    {environmentSectionOpen ? (
                      <div className="avatar-creator-environment-card-body">
                        {environmentView === "background" ? (
                          <>
                            <div className="avatar-creator-background-mode-switch">
                              {(["image", "video"] as const).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  className={draft.backgroundType === option ? "is-selected" : ""}
                                  onClick={() => updateDraft("backgroundType", option)}
                                >
                                  {option === "image" ? "Image" : "Video"}
                                </button>
                              ))}
                            </div>

                            <div className="avatar-creator-background-grid">
                              {environmentBackgroundLibrary[draft.backgroundType === "video" ? "video" : "image"].map((item, index) => {
                                const isSelectedTile = draft.backgroundValue === item;

                                return (
                                  <button
                                    key={`${draft.backgroundType}-${index}`}
                                    type="button"
                                    className={`avatar-creator-environment-tile ${isSelectedTile ? "is-active" : ""}`}
                                    onClick={() => updateDraft("backgroundValue", item)}
                                  >
                                    <img src={item} alt={`Background ${index + 1}`} />
                                  </button>
                                );
                              })}
                            </div>

                            <div className="avatar-creator-background-controls">
                              <label className="avatar-creator-color-control">
                                <span>Background Color</span>
                                <input
                                  type="color"
                                  value={draft.backgroundType === "solid" ? draft.backgroundValue || "#dbeafe" : "#dbeafe"}
                                  onChange={(event) => {
                                    updateDraft("backgroundType", "solid");
                                    updateDraft("backgroundValue", event.target.value);
                                  }}
                                />
                              </label>
                              <label className="avatar-creator-transparent-toggle">
                                <input
                                  type="checkbox"
                                  checked={draft.backgroundType === "transparent"}
                                  onChange={(event) => {
                                    if (event.target.checked) {
                                      updateDraft("backgroundType", "transparent");
                                      updateDraft("backgroundValue", "transparent");
                                    } else {
                                      updateDraft("backgroundType", "image");
                                    }
                                  }}
                                />
                                <span>Transparent</span>
                              </label>
                            </div>
                          </>
                        ) : (
                          <div className="avatar-creator-background-grid">
                            {environmentOptions.map((option, index) => {
                              const isSelectedTile = draft.environment3d === option;

                              return (
                                <button
                                  key={option}
                                  type="button"
                                  className={`avatar-creator-environment-tile ${isSelectedTile ? "is-active" : ""}`}
                                  onClick={() => updateDraft("environment3d", option)}
                                >
                                  <img
                                    src={environmentBackgroundLibrary.image[index % environmentBackgroundLibrary.image.length]}
                                    alt={option}
                                  />
                                  <span>{option}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="avatar-creator-environment-card avatar-creator-environment-card-collapsed">
                    <button type="button" className="avatar-creator-environment-card-head">
                      <span>Lighting</span>
                      <i className="bi bi-chevron-right" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "brain" ? (
              <div className="avatar-creator-pane">
                <div className="avatar-creator-environment-shell">
                  <div className="avatar-creator-environment-topbar avatar-creator-brain-topbar">
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${brainView === "foundation" ? "is-selected" : ""}`}
                      onClick={() => setBrainView("foundation")}
                    >
                      <i className="bi bi-grid-fill" />
                      <span>Foundations</span>
                    </button>
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${brainView === "knowledge_base" ? "is-selected" : ""}`}
                      onClick={() => setBrainView("knowledge_base")}
                    >
                      <i className="bi bi-file-earmark-text" />
                      <span>Knowledge Base</span>
                    </button>
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${brainView === "functions" ? "is-selected" : ""}`}
                      onClick={() => setBrainView("functions")}
                    >
                      <i className="bi bi-sigma" />
                      <span>Functions</span>
                    </button>
                  </div>

                  <div className="avatar-creator-environment-card">
                    <div className="avatar-creator-environment-card-body">
                      {brainView === "foundation" ? (
                        <div className="avatar-creator-brain-form">
                          <div className="avatar-creator-brain-card">
                            <div className="avatar-creator-brain-card-title">Mode</div>
                            <div className="avatar-creator-brain-mode-list">
                              {foundationModes.map((mode) => (
                                <label key={mode} className="avatar-creator-brain-radio">
                                  <input
                                    type="radio"
                                    name="foundation-mode"
                                    checked={draft.foundationMode === mode}
                                    onChange={() => updateDraft("foundationMode", mode)}
                                  />
                                  <span>{mode}</span>
                                  {mode === "Composite" ? <small>currently set</small> : null}
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="avatar-creator-brain-card">
                            <div className="avatar-creator-brain-card-title">Avatar Engine</div>
                            <div className="avatar-creator-brain-fields">
                              <label>
                                <span>Service provider or framework</span>
                                <input className="form-control" value={draft.avatarEngine} onChange={(event) => updateDraft("avatarEngine", event.target.value)} />
                              </label>
                              <label>
                                <span>Base URL</span>
                                <input className="form-control" value={draft.baseUrl} onChange={(event) => updateDraft("baseUrl", event.target.value)} />
                              </label>
                              <label>
                                <span>API Key</span>
                                <input className="form-control" value={draft.apiKey} onChange={(event) => updateDraft("apiKey", event.target.value)} />
                              </label>
                              <label>
                                <span>Select Model</span>
                                <input className="form-control" value={draft.model} onChange={(event) => updateDraft("model", event.target.value)} />
                              </label>
                              <label className="avatar-creator-brain-fields-full">
                                <span>Prompt</span>
                                <textarea className="form-control" rows={5} value={draft.prompt} onChange={(event) => updateDraft("prompt", event.target.value)} />
                              </label>
                              <label>
                                <span>STT Provider</span>
                                <input className="form-control" value={draft.sttProvider} onChange={(event) => updateDraft("sttProvider", event.target.value)} />
                              </label>
                              <label>
                                <span>Language</span>
                                <input className="form-control" value={draft.language} onChange={(event) => updateDraft("language", event.target.value)} />
                              </label>
                              <label>
                                <span>TTS Provider</span>
                                <input className="form-control" value={draft.ttsProvider} onChange={(event) => updateDraft("ttsProvider", event.target.value)} />
                              </label>
                              <label>
                                <span>Select Voice</span>
                                <input className="form-control" value={draft.voiceName} onChange={(event) => updateDraft("voiceName", event.target.value)} />
                              </label>
                              <label className="avatar-creator-brain-fields-full">
                                <span>Context Phrases</span>
                                <textarea
                                  className="form-control"
                                  rows={3}
                                  value={draft.contextPhrases.join("\n")}
                                  onChange={(event) => updateDraft("contextPhrases", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))}
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {brainView === "knowledge_base" ? (
                        <div className="avatar-creator-brain-card">
                          <div className="avatar-creator-brain-card-title">Knowledge Base</div>
                          <textarea
                            className="form-control"
                            rows={12}
                            value={draft.knowledgeBaseItems.join("\n")}
                            onChange={(event) => updateDraft("knowledgeBaseItems", event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))}
                            placeholder="Add one knowledge base reference per line"
                          />
                        </div>
                      ) : null}

                      {brainView === "functions" ? (
                        <div className="avatar-creator-brain-card">
                          <div className="d-flex align-items-center justify-content-between gap-3 mb-3">
                            <div className="avatar-creator-brain-card-title mb-0">Functions</div>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              onClick={() =>
                                updateDraft("functions", [
                                  ...draft.functions,
                                  {
                                    id: `fn-${Date.now()}`,
                                    name: "",
                                    description: "",
                                  },
                                ])
                              }
                            >
                              Add Function
                            </button>
                          </div>
                          <div className="d-grid gap-3">
                            {draft.functions.length ? draft.functions.map((fn) => (
                              <div key={fn.id} className="border rounded-3 p-3">
                                <input
                                  className="form-control mb-2"
                                  value={fn.name}
                                  onChange={(event) =>
                                    updateDraft(
                                      "functions",
                                      draft.functions.map((item) => (item.id === fn.id ? { ...item, name: event.target.value } : item)),
                                    )
                                  }
                                  placeholder="Function name"
                                />
                                <textarea
                                  className="form-control"
                                  rows={3}
                                  value={fn.description}
                                  onChange={(event) =>
                                    updateDraft(
                                      "functions",
                                      draft.functions.map((item) => (item.id === fn.id ? { ...item, description: event.target.value } : item)),
                                    )
                                  }
                                  placeholder="Function description"
                                />
                              </div>
                            )) : <div className="small text-body-secondary">No functions added yet.</div>}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "advanced" ? (
              <div className="avatar-creator-pane">
                {([
                  ["general", "General"],
                  ["usageLimits", "Usage Limits"],
                  ["interruptions", "Interruptions"],
                  ["vad", "Voice Activity Detection (VAD)"],
                  ["launchVisibility", "Launch & Visibility"],
                  ["styling", "Styling"],
                ] as Array<[keyof AvatarProfile["advanced"], string]>).map(([key, label]) => (
                  <div key={key} className="avatar-creator-accordion-item">
                    <button
                      type="button"
                      className="avatar-creator-accordion-trigger"
                      onClick={() => setExpandedAdvancedSection((current) => (current === key ? "" as keyof AvatarProfile["advanced"] : key))}
                    >
                      <span>{label}</span>
                      <i className={`bi ${expandedAdvancedSection === key ? "bi-chevron-up" : "bi-chevron-right"}`} />
                    </button>
                    {expandedAdvancedSection === key ? (
                      <div className="avatar-creator-accordion-body">
                        <textarea
                          className="form-control"
                          rows={4}
                          value={draft.advanced[key]}
                          onChange={(event) => updateAdvanced(key, event.target.value)}
                          placeholder={`Add ${label.toLowerCase()} guidance`}
                        />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "embed" ? (
              <div className="avatar-creator-pane">
                <div className="avatar-creator-environment-shell">
                  <div className="avatar-creator-environment-topbar avatar-creator-brain-topbar">
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${embedView === "iframe" ? "is-selected" : ""}`}
                      onClick={() => setEmbedView("iframe")}
                    >
                      <i className="bi bi-code-slash" />
                      <span>iFrame</span>
                    </button>
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${embedView === "avatar_environment_json" ? "is-selected" : ""}`}
                      onClick={() => setEmbedView("avatar_environment_json")}
                    >
                      <i className="bi bi-badge-3d" />
                      <span>Avatar/Environment JSON</span>
                    </button>
                    <button
                      type="button"
                      className={`avatar-creator-environment-tab ${embedView === "client_json" ? "is-selected" : ""}`}
                      onClick={() => setEmbedView("client_json")}
                    >
                      <i className="bi bi-palette2" />
                      <span>Client JSON</span>
                    </button>
                  </div>

                  <div className="avatar-creator-environment-card">
                    <div className="avatar-creator-environment-card-body">
                      {embedView === "iframe" ? (
                        <div className="avatar-creator-brain-card">
                          <div className="avatar-creator-brain-card-title">Embed Code</div>
                          <p className="text-body-secondary small mb-3">Use this code to embed your avatar in an iframe on your website.</p>
                          <div className="avatar-creator-code-card">
                            <button
                              type="button"
                              className="avatar-creator-code-copy"
                              onClick={async () => {
                                await navigator.clipboard.writeText(draft.embed.iframe);
                                toast.success("iFrame copied.");
                              }}
                            >
                              <i className="bi bi-copy" />
                            </button>
                            <textarea className="form-control avatar-creator-code" rows={7} value={draft.embed.iframe} readOnly />
                          </div>
                          <p className="text-body-secondary small mb-0 mt-3">Alternatively, use our SDK to integrate your avatar directly into your code.</p>
                        </div>
                      ) : null}

                      {embedView === "avatar_environment_json" ? (
                        <div className="avatar-creator-brain-card">
                          <div className="avatar-creator-brain-card-title">Avatar / Environment JSON</div>
                          <div className="avatar-creator-code-card">
                            <button
                              type="button"
                              className="avatar-creator-code-copy"
                              onClick={async () => {
                                await navigator.clipboard.writeText(draft.embed.avatarEnvironmentJson);
                                toast.success("Avatar / Environment JSON copied.");
                              }}
                            >
                              <i className="bi bi-copy" />
                            </button>
                            <textarea className="form-control avatar-creator-code" rows={14} value={draft.embed.avatarEnvironmentJson} readOnly />
                          </div>
                        </div>
                      ) : null}

                      {embedView === "client_json" ? (
                        <div className="avatar-creator-brain-card">
                          <div className="avatar-creator-brain-card-title">Client JSON</div>
                          <div className="avatar-creator-code-card">
                            <button
                              type="button"
                              className="avatar-creator-code-copy"
                              onClick={async () => {
                                await navigator.clipboard.writeText(draft.embed.clientJson);
                                toast.success("Client JSON copied.");
                              }}
                            >
                              <i className="bi bi-copy" />
                            </button>
                            <textarea className="form-control avatar-creator-code" rows={14} value={draft.embed.clientJson} readOnly />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="avatar-creator-environment-card avatar-creator-environment-card-collapsed">
                    <button type="button" className="avatar-creator-environment-card-head">
                      <span>URL Parameters</span>
                      <i className="bi bi-chevron-right" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="d-flex justify-content-end gap-2 mt-4 flex-wrap">
              <button type="button" className="btn btn-light" onClick={createAvatar}>
                New Avatar
              </button>
              <button type="button" className="btn btn-primary" onClick={saveProfile}>
                Save Changes
              </button>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
};

export default AvatarCreator;
