import Link from "next/link";
import { Icon } from "@/components/Icon";

export default function NotFound() {
  return <main className="standalone-state"><span><Icon name="search" /></span><h1>No encontramos esta página</h1><p>Puede que el enlace haya cambiado o que no tengas acceso.</p><Link className="button button-primary" href="/">Volver al inicio</Link></main>;
}

