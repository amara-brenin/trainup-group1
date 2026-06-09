declare module "@react-oauth/google" {
  import type { ReactNode } from "react";

  export type CredentialResponse = {
    credential?: string;
    select_by?: string;
    clientId?: string;
  };

  export type GoogleOAuthProviderProps = {
    clientId: string;
    children: ReactNode;
  };

  export function GoogleOAuthProvider(
    props: GoogleOAuthProviderProps,
  ): ReactNode;

  export type GoogleLoginProps = {
    onSuccess: (credentialResponse: CredentialResponse) => void;
    onError?: () => void;
    text?:
      | "signin_with"
      | "signup_with"
      | "continue_with"
      | "signin";
    theme?: "outline" | "filled_blue" | "filled_black";
    size?: "large" | "medium" | "small";
    shape?: "rectangular" | "pill" | "circle" | "square";
    width?: string | number;
    hosted_domain?: string;
  };

  export function GoogleLogin(props: GoogleLoginProps): ReactNode;
}
