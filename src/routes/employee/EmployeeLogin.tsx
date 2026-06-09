import PublicRoleLoginCard from "../../component/common/PublicRoleLoginCard";
import { ssoUsers } from "../../constant/demoExperiences";

const defaultEmployeeId = "SAM-1042";

const EmployeeLogin = () => {
  return (
    <PublicRoleLoginCard
      role="employee"
      title="Employee Sign In"
      description="Enter your employee SSO credentials to access the Samsung LMS training player."
      identifierLabel="Employee ID"
      identifierPlaceholder="SAM-1042"
      demoText="Demo credentials: SAM-1042 / Sam@1042"
      initialValues={{
        identifier: defaultEmployeeId,
        password: ssoUsers[defaultEmployeeId].password,
      }}
      redirectTo="/employee-sso"
      authenticate={(identifier, password) => {
        const employee = ssoUsers[identifier as keyof typeof ssoUsers];

        if (employee && employee.password === password.trim()) {
          return {
            session: {
              role: "employee",
              identifier,
              name: employee.name,
              roleLabel: "Employee",
              dept: employee.dept,
            },
            message: "Employee login successful.",
          };
        }

        return {
          message: "Invalid employee credentials.",
          errors: {
            identifier: "Use a valid Samsung employee ID.",
            password: "Password does not match the selected employee.",
          },
        };
      }}
    />
  );
};

export default EmployeeLogin;
