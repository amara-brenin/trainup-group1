import { Suspense } from "react";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "bootstrap-icons/font/bootstrap-icons.css";
import "react-toastify/dist/ReactToastify.css";
import "./assets/css/app.min.css";
import "./assets/css/icons.min.css";
import "./assets/css/custom.css";
import "./assets/css/design-system.css";
import "./assets/css/admin.css";
import "./assets/css/samsung-lms.css";
import { ErrorBoundary } from "./component/common/ErrorBoundary";
import { Loader } from "./component/common/Loader";
import ProviderCustom from "./layouts/ProviderCustom";
import { router } from "./router";
import { store } from "./store";

const App = () => {
  return (
    <ErrorBoundary>
      <Provider store={store}>
        <ProviderCustom>
          <Suspense fallback={<Loader />}>
            <RouterProvider router={router} />
          </Suspense>
          <ToastContainer position="top-right" autoClose={2500} newestOnTop />
        </ProviderCustom>
      </Provider>
    </ErrorBoundary>
  );
};

export default App;
