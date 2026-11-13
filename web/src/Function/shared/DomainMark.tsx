import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { DomainIcon } from '@/Function/shared/conceptIcons';

/** A Domain's own mark, wherever a Domain is named: the sidebar, a picker, a
 *  chip. Its uploaded image, else its icon and colour, else the Domain glyph. */
export function DomainMark({ domain, size = 15 }: { domain: { icon?: string | null; color?: string | null }; size?: number }) {
  // Domain is the size reference; the other sidebar glyphs are sized up to
  // match this concept icon. An uploaded image is a complete mark of its own;
  // otherwise the Domain's icon and colour are drawn as a Strategy's or an
  // Object's are (ItemIcon), with the Domain mark when it has none.
  if (domain.icon && /^(https?:|data:|\/)/.test(domain.icon)) {
    return (
      // A Domain icon is whatever file its owner uploaded. Routing it through
      // next/image would put every one of them through the deployment's image
      // optimizer, which is a billed service and a decision that is not this
      // component's to make. Same call as the avatar in Profile settings.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={domain.icon}
        alt=""
        className="rounded object-cover flex-shrink-0"
        style={{ width: size + 2, height: size + 2 }}
      />
    );
  }
  return <ItemIcon icon={domain.icon} color={domain.color} size={size} fallback={<DomainIcon size={size} />} />;
}
