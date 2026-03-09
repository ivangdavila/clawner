import './globals.css';

export const metadata = {
  title: 'Clawner - OpenClaw Orchestrator',
  description: 'Monitor and manage your OpenClaw agents remotely',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
