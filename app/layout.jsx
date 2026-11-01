import "./globals.css";

export const metadata = {
  title: "3D Bee · Order Desk",
  description: "3D Bee order management dashboard"
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#f6c343" };

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
