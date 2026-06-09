import PublicRoleLoginCard from "../../component/common/PublicRoleLoginCard";
import { trainerLoginUser } from "../../constant/demoExperiences";

const TrainerLogin = () => {
  return (
    <PublicRoleLoginCard
      role="trainer"
      title="Trainer Sign In"
      description="Enter your trainer credentials to access the content trainer panel."
      identifierLabel="Email address"
      identifierPlaceholder="trainer@samsung.com"
      identifierType="email"
      demoText={`Demo credentials: ${trainerLoginUser.email} / ${trainerLoginUser.password}`}
      initialValues={{
        identifier: trainerLoginUser.email,
        password: trainerLoginUser.password,
      }}
      redirectTo="/trainer"
      authenticate={(identifier, password) => {
        if (
          identifier.trim().toLowerCase() === trainerLoginUser.email &&
          password.trim() === trainerLoginUser.password
        ) {
          return {
            session: {
              role: "trainer",
              identifier: trainerLoginUser.email,
              name: trainerLoginUser.name,
              roleLabel: trainerLoginUser.roleLabel,
            },
            message: "Trainer login successful.",
          };
        }

        return {
          message: "Invalid trainer credentials.",
          errors: {
            identifier: "Use the demo trainer email.",
            password: "Use the demo trainer password.",
          },
        };
      }}
    />
  );
};

export default TrainerLogin;
