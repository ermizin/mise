import type { RecipeFamilyIngredient, RecipeFamilySolverInput } from "./recipe-engine";

export const MOBILE_BOOTSTRAP_SCHEMA_VERSION = 2 as const;
export const MOBILE_CATALOG_SCHEMA_VERSION = 3 as const;

export type MobileMealSlot = "breakfast" | "lunch" | "dinner" | "snack1" | "snack2";
export type MobileMenuStyle = "simple" | "protein" | "budget";
export type MobileKitchenEquipment =
  | "stove"
  | "pot"
  | "pan"
  | "oven"
  | "baking_dish"
  | "multicooker"
  | "air_fryer"
  | "blender"
  | "microwave"
  | "waffle_iron"
  | "pressure_cooker";
export type MobileAllergen =
  | "milk"
  | "egg"
  | "gluten"
  | "fish"
  | "crustaceans"
  | "soy"
  | "peanut"
  | "treeNuts"
  | "sesame"
  | "mustard"
  | "molluscs";

export type MobileRecipe = {
  id: string;
  slot: MobileMealSlot;
  title: string;
  macros: { kcal: number; protein: number; fat: number; carbs: number };
  timeMinutes: number;
  menuTags: MobileMenuStyle[];
  equipmentOptions: {
    id: string;
    label: string;
    requiredEquipment: MobileKitchenEquipment[];
  }[];
  costTier: { value: number; label: string };
  servingMass: { grams: number; status: "estimated_not_verified_cooked_yield" };
  ingredients: {
    id: string;
    canonicalIngredientId: string;
    name: string;
    group: string;
    baseAmount: number;
    unit: "g" | "ml" | "piece";
    allergens: MobileAllergen[];
    checkLabel: boolean;
  }[];
  steps: string[];
  instructions: {
    text: string;
    minutes: number;
    hands: boolean;
    at: number;
    ingredientIds: string[];
  }[];
  effort: { activeMinutes: number; difficulty: number; cookware: number; parallelProcesses: number };
  storage: {
    refrigerator: string;
    freezer: string;
    thaw: string;
    refrigeratorDays: number;
    freezerDays: number;
    freezable: boolean;
    reheat: string;
  };
  packing: { portion: string; label: string };
  /** Minimal deterministic solver input bundled for complete offline planning. */
  solver: RecipeFamilySolverInput;
  photo: {
    path: string;
    contentType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
    sha256: string;
    attribution: string;
    sourceUrl: string;
    origin: "source" | "generated";
  };
};

export type MobileBootstrap = {
  schemaVersion: typeof MOBILE_BOOTSTRAP_SCHEMA_VERSION;
  catalogSchemaVersion: typeof MOBILE_CATALOG_SCHEMA_VERSION;
  capabilities: { catalog: true; planGeneration: true; offlinePlanGeneration: true };
  limits: {
    periodDays: { min: 1; max: 14 };
    people: { min: 1; max: 4 };
    mealSlots: MobileMealSlot[];
    menuStyles: MobileMenuStyle[];
    kitchenEquipment: MobileKitchenEquipment[];
  };
  recipes: MobileRecipe[];
};

type RuntimeRecipe = {
  id: string;
  slot: MobileMealSlot;
  title: string;
  macros: MobileRecipe["macros"];
  timeMinutes: number;
  menuTags: MobileMenuStyle[];
  equipmentOptions: MobileRecipe["equipmentOptions"];
  costTier: { value: number; label?: string };
  servingMass: { grams: number; status?: string };
  shoppingIngredients: {
    sourceIngredientId: string;
    sourceIngredientIds?: string[];
    canonicalIngredientId: string;
    nameRu: string;
    group: string;
    allergens: string[];
    checkLabel: boolean;
  }[];
  steps: string[];
  instructions?: MobileRecipe["instructions"];
  effort: MobileRecipe["effort"];
  storage: Omit<MobileRecipe["storage"], "reheat"> & { reheat?: string };
  packing: MobileRecipe["packing"];
  provenance: {
    kind?: string;
    sourceTitle?: string;
    sourceUrl: string;
    editoriallyApproved?: boolean;
    preview: {
      kind: string;
      imageUrl: string;
      contentType?: MobileRecipe["photo"]["contentType"];
      sha256?: string;
      attribution?: string;
    };
  };
  recipeFamily: {
    reviewStatus: string;
    ingredients: RecipeFamilyIngredient[];
    miseInstructions?: { text: string; ingredientIds: string[] }[];
    minViableCalories: number;
    maxViableCalories: number;
    minimumProtein: number;
    geometryLockedMax?: number;
  };
};

export type RuntimeCatalogForMobile = {
  schemaVersion: number;
  recipes: RuntimeRecipe[];
  simpleRecipes?: RuntimeRecipe[];
};
export type RuntimeAuditForMobile = {
  schemaVersion: number;
  cards: { id: string; verdict: string }[];
};
export type SimplePhotoManifestForMobile = {
  schemaVersion: number;
  images: {
    id: string;
    localPath: string;
    sha256: string;
    subject?: string;
    sourceUrl?: string;
    origin: "source" | "generated";
    rightsStatus: string;
  }[];
};

const localPhotoPath = /^\/recipe-images\/[a-z0-9-]+\.(?:jpg|png|webp|avif)$/u;
const checksum = /^[a-f0-9]{64}$/u;
const mobileAllergenMap: Readonly<Record<string, MobileAllergen | undefined>> = {
  crustaceans: "crustaceans",
  shrimp: "crustaceans",
  egg: "egg",
  fish: "fish",
  gluten: "gluten",
  milk: "milk",
  molluscs: "molluscs",
  mustard: "mustard",
  nuts: "treeNuts",
  peanuts: "peanut",
  sesame: "sesame",
  soy: "soy",
};

export function buildMobileBootstrap(
  catalog: RuntimeCatalogForMobile,
  audit: RuntimeAuditForMobile,
  simplePhotos: SimplePhotoManifestForMobile,
): MobileBootstrap {
  if (catalog.schemaVersion !== MOBILE_CATALOG_SCHEMA_VERSION) throw new Error("Unsupported recipe catalog version");
  if (audit.schemaVersion !== 1) throw new Error("Unsupported recipe audit version");
  if (simplePhotos.schemaVersion !== 1) throw new Error("Unsupported simple photo manifest version");
  const auditedReadyIds = new Set(audit.cards.filter((card) => card.verdict === "ready").map((card) => card.id));
  const simpleRecipes = catalog.simpleRecipes ?? [];
  const simpleIds = new Set(simpleRecipes.map((recipe) => recipe.id));
  const simplePhotoById = new Map(simplePhotos.images.map((photo) => [photo.id, photo]));

  const recipes = [...catalog.recipes, ...simpleRecipes].flatMap((recipe): MobileRecipe[] => {
    // The checked-in catalog is hard-gated. Recheck the client-facing boundary
    // so an accidental future catalog change cannot expose an unreviewed card.
    const isSimple = simpleIds.has(recipe.id);
    if ((!isSimple && !auditedReadyIds.has(recipe.id)) || recipe.recipeFamily.reviewStatus !== "pilot") return [];
    if (recipe.recipeFamily.ingredients.length < 3) return [];
    const preview = recipe.provenance.preview;
    const simplePhoto = isSimple ? simplePhotoById.get(recipe.id) : undefined;
    const photoPath = simplePhoto?.localPath ?? preview.imageUrl;
    const photoSha = simplePhoto?.sha256 ?? preview.sha256;
    const photoAttribution = preview.attribution ?? recipe.provenance.sourceTitle ?? simplePhoto?.subject ?? recipe.title;
    const photoSourceUrl = recipe.provenance.sourceUrl || simplePhoto?.sourceUrl || "";
    const photoContentType: MobileRecipe["photo"]["contentType"] | undefined = preview.contentType
      ?? (photoPath.endsWith(".png") ? "image/png" : photoPath.endsWith(".webp") ? "image/webp" : photoPath.endsWith(".avif") ? "image/avif" : "image/jpeg");
    if (!localPhotoPath.test(photoPath) || !photoSha || !checksum.test(photoSha) || !photoAttribution || !photoContentType) return [];
    if (isSimple) {
      if (!simplePhoto || recipe.provenance.editoriallyApproved !== true || !simplePhoto.rightsStatus) return [];
    } else if (preview.kind !== "source_preview" || !/^https:\/\//u.test(photoSourceUrl)) return [];

    const shoppingById = new Map(
      recipe.shoppingIngredients.flatMap((ingredient) =>
        (ingredient.sourceIngredientIds?.length ? ingredient.sourceIngredientIds : [ingredient.sourceIngredientId])
          .map((sourceIngredientId) => [sourceIngredientId, ingredient] as const),
      ),
    );
    const ingredients = recipe.recipeFamily.ingredients.map((ingredient) => {
      const source = shoppingById.get(ingredient.sourceIngredientId);
      if (!source) throw new Error(`Missing mobile ingredient for ${recipe.id}`);
      return {
        id: ingredient.sourceIngredientId,
        canonicalIngredientId: source.canonicalIngredientId,
        name: source.nameRu,
        group: source.group,
        baseAmount: ingredient.baseAmount,
        unit: ingredient.unit,
        allergens: [
          ...new Set(
            source.allergens.flatMap((allergen) => {
              const mapped = mobileAllergenMap[allergen];
              return mapped ? [mapped] : [];
            }),
          ),
        ],
        checkLabel: source.checkLabel,
      };
    });

    return [{
      id: recipe.id,
      slot: recipe.slot,
      title: recipe.title,
      macros: recipe.macros,
      timeMinutes: recipe.timeMinutes,
      menuTags: recipe.menuTags,
      equipmentOptions: recipe.equipmentOptions,
      costTier: {
        value: recipe.costTier.value,
        label: recipe.costTier.label ?? (["", "экономно", "средне", "дороже"][recipe.costTier.value] || "условно"),
      },
      servingMass: { grams: recipe.servingMass.grams, status: "estimated_not_verified_cooked_yield" },
      ingredients,
      steps: recipe.steps,
      instructions: recipe.instructions ?? (recipe.recipeFamily.miseInstructions ?? recipe.steps.map((text) => ({ text, ingredientIds: [] })))
        .map((instruction) => ({ text: instruction.text, minutes: 0, hands: false, at: 0, ingredientIds: instruction.ingredientIds })),
      effort: {
        activeMinutes: recipe.effort.activeMinutes,
        difficulty: recipe.effort.difficulty,
        cookware: recipe.effort.cookware,
        parallelProcesses: recipe.effort.parallelProcesses,
      },
      storage: {
        refrigerator: recipe.storage.refrigerator,
        freezer: recipe.storage.freezer,
        thaw: recipe.storage.thaw,
        refrigeratorDays: recipe.storage.refrigeratorDays,
        freezerDays: recipe.storage.freezerDays,
        freezable: recipe.storage.freezable,
        reheat: recipe.storage.reheat ?? "Разогрейте до безопасной температуры перед подачей.",
      },
      packing: recipe.packing,
      solver: {
        id: recipe.id,
        ingredients: recipe.recipeFamily.ingredients,
        minViableCalories: recipe.recipeFamily.minViableCalories,
        maxViableCalories: recipe.recipeFamily.maxViableCalories,
        minimumProtein: recipe.recipeFamily.minimumProtein,
        ...(recipe.recipeFamily.geometryLockedMax
          ? { geometryLockedMax: recipe.recipeFamily.geometryLockedMax }
          : {}),
      },
      photo: {
        path: photoPath,
        contentType: photoContentType,
        sha256: photoSha,
        attribution: photoAttribution,
        sourceUrl: photoSourceUrl,
        origin: simplePhoto?.origin === "generated" ? "generated" : "source",
      },
    }];
  });

  return {
    schemaVersion: MOBILE_BOOTSTRAP_SCHEMA_VERSION,
    catalogSchemaVersion: MOBILE_CATALOG_SCHEMA_VERSION,
    capabilities: { catalog: true, planGeneration: true, offlinePlanGeneration: true },
    limits: {
      periodDays: { min: 1, max: 14 },
      people: { min: 1, max: 4 },
      mealSlots: ["breakfast", "lunch", "dinner", "snack1", "snack2"],
      menuStyles: ["simple", "protein", "budget"],
      kitchenEquipment: ["stove", "pot", "pan", "oven", "baking_dish", "multicooker", "air_fryer", "blender", "microwave", "waffle_iron", "pressure_cooker"],
    },
    recipes,
  };
}
