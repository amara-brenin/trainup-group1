import PublicRoleLoginCard from "../../component/common/PublicRoleLoginCard";
import { reviewerLoginUser } from "../../constant/demoExperiences";

const ReviewerLogin = () => {
  return (
    <PublicRoleLoginCard
      role="reviewer"
      title="Reviewer Sign In"
      description="Enter your reviewer credentials to access the review queue and approvals."
      identifierLabel="Email address"
      identifierPlaceholder="reviewer@samsung.com"
      identifierType="email"
      demoText={`Demo credentials: ${reviewerLoginUser.email} / ${reviewerLoginUser.password}`}
      initialValues={{
        identifier: reviewerLoginUser.email,
        password: reviewerLoginUser.password,
      }}
      redirectTo="/reviewer"
      authenticate={(identifier, password) => {
        if (
          identifier.trim().toLowerCase() === reviewerLoginUser.email &&
          password.trim() === reviewerLoginUser.password
        ) {
          return {
            session: {
              role: "reviewer",
              identifier: reviewerLoginUser.email,
              name: reviewerLoginUser.name,
              roleLabel: reviewerLoginUser.roleLabel,
            },
            message: "Reviewer login successful.",
          };
        }

        return {
          message: "Invalid reviewer credentials.",
          errors: {
            identifier: "Use the demo reviewer email.",
            password: "Use the demo reviewer password.",
          },
        };
      }}
    />
  );
};

export default ReviewerLogin;
