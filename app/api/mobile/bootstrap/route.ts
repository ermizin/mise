import runtimeRecipeCatalogJson from "../../../../data/recipe-runtime-catalog.json";
import runtimeRecipeAuditJson from "../../../../data/recipe-release-audit.json";
import simplePhotoManifestJson from "../../../../data/simple-recipe-images.json";
import {
  buildMobileBootstrap,
  type RuntimeCatalogForMobile,
  type SimplePhotoManifestForMobile,
} from "../../../../domain/mobile";

export function GET() {
  try {
    const bootstrap = buildMobileBootstrap(
      runtimeRecipeCatalogJson as RuntimeCatalogForMobile,
      runtimeRecipeAuditJson,
      simplePhotoManifestJson as SimplePhotoManifestForMobile,
    );
    return Response.json(bootstrap, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return Response.json({ error: "mobile catalog unavailable" }, { status: 503 });
  }
}
