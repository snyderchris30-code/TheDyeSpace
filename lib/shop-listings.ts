const SHOP_PRODUCT_PREFIX = "shop-product-";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function isShopListingId(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(SHOP_PRODUCT_PREFIX);
}

export function resolveShopListingContext(postId: string, sellerUserId?: string | null) {
  if (!isShopListingId(postId)) {
    return null;
  }

  const suffix = postId.slice(SHOP_PRODUCT_PREFIX.length);
  if (!suffix) {
    return null;
  }

  if (sellerUserId) {
    const sellerPrefix = `${sellerUserId}-`;
    if (!suffix.startsWith(sellerPrefix)) {
      return null;
    }

    const productId = suffix.slice(sellerPrefix.length);
    return productId ? { sellerUserId, productId } : null;
  }

  const possibleSellerUserId = suffix.slice(0, 36);
  if (!isUuid(possibleSellerUserId) || suffix.charAt(36) !== "-") {
    return null;
  }

  const productId = suffix.slice(37);
  if (!productId) {
    return null;
  }

  return {
    sellerUserId: possibleSellerUserId,
    productId,
  };
}