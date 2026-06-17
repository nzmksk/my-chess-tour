const CHIP_API_URL = "https://gate.chip-in.asia/api/v1";

interface CreatePurchaseParams {
  amountCents: number;
  clientEmail: string;
  productName: string;
  referenceId: string;
  successRedirect: string;
  failureRedirect: string;
}

export interface ChipPurchase {
  id: string;
  checkout_url: string;
  status: string;
}

export async function createChipPurchase(
  params: CreatePurchaseParams,
): Promise<ChipPurchase> {
  const apiKey = process.env.CHIP_API_KEY;
  const brandId = process.env.CHIP_BRAND_ID;

  if (!apiKey || !brandId) {
    throw new Error("CHIP_API_KEY and CHIP_BRAND_ID must be configured");
  }

  const res = await fetch(`${CHIP_API_URL}/purchases/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      purchase: {
        currency: "MYR",
        products: [
          {
            name: params.productName,
            price: params.amountCents,
            quantity: 1,
          },
        ],
      },
      client: { email: params.clientEmail },
      brand_id: brandId,
      reference_id: params.referenceId,
      success_redirect: params.successRedirect,
      failure_redirect: params.failureRedirect,
      send_receipt: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CHIP API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<ChipPurchase>;
}
