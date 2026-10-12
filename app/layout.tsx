import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Sajada — Tumbuh Bersama',description:'Ruang kerja koperasi Sajada: anggota, marketplace, jaringan, dan akuntansi.'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="id"><body>{children}</body></html>}
