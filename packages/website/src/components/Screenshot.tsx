import { asset } from "../content";

type Props = {
  name: "file-view" | "query";
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
};

/** A 1440 × 900 app screenshot, served as WebP at two widths. */
export function Screenshot({ name, alt, sizes, priority = false, className = "" }: Props) {
  return (
    <img
      src={asset(`screenshots/${name}-1440.webp`)}
      srcSet={`${asset(`screenshots/${name}-720.webp`)} 720w, ${asset(`screenshots/${name}-1440.webp`)} 1440w`}
      sizes={sizes}
      alt={alt}
      width={1440}
      height={900}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={`block h-auto w-full ${className}`}
    />
  );
}
