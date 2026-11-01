import Image from 'next/image';

/**
 * The university mark. One component for every placement so the artwork, its aspect ratio and its alignment cannot drift:
 * the source is a tightly trimmed transparent PNG (1200 × 284), so the logo is always drawn at its natural proportions and
 * sits on whatever surface it is placed on. It is served as-is (`unoptimized`): the optimizer's lossy resize made the small lettering soft. `plate` puts it on a white plate with equal padding on all sides (for dark surfaces).
 */
export const LOGO_ALT = 'Shaheed Zulfiqar Ali Bhutto Medical University, Islamabad';
export function BrandLogo({ plate = false, priority = false, className = '' }: { plate?: boolean; priority?: boolean; className?: string }) {
  return (
    <div className={`logo ${plate ? 'logo-plate' : ''} ${className}`}>
      <Image src="/logo.png" alt={LOGO_ALT} width={1200} height={284} priority={priority} unoptimized />
    </div>
  );
}
