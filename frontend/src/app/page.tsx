import { redirect } from "next/navigation";

// Signed-in users land on the dashboard; the dashboard's API calls redirect to /login on 401.
export default function Home() {
  redirect("/dashboard");
}
