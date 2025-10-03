import NavBar from "./NavBar";
import { Routes, Route } from "react-router-dom";
import About from "./About";
import Reviews from "./Reviews";
import BookAppointment from "./BookAppointment";
import AllAppointments from "./AllAppointments";
import Home from "./Home";
import AdminRoute from "./AdminRoute";
import Login from "./Login";
import Management from "./Management";

function App() {
  return (
    <div className="mx-auto">
      <NavBar />
      <main className="pt-20">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/About" element={<About />} />
          <Route path="/Reviews" element={<Reviews />} />
          <Route path="/BookAppointment" element={<BookAppointment />} />
          <Route
            path="/Management"
            element={
              <AdminRoute>
                <Management />
              </AdminRoute>
            }
          />
          <Route
            path="/AllAppointments"
            element={
              <AdminRoute>
                <AllAppointments />
              </AdminRoute>
            }
          />
          <Route path="/login" element={<Login></Login>} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
