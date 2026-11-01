import { Loading } from '@/ui';

/** Shown by Next while a route segment loads; keeps the shell (sidebar, topbar) in place. */
export default function RouteLoading() {
  return <Loading />;
}
