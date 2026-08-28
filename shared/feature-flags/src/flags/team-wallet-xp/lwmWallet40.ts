import { z } from "zod";
import { flagWith } from "../../define";

export const lwmWallet40 = flagWith(
  {
    tour: z.boolean(),
    lazyOnboarding: z.boolean(),
    assetSection: z.boolean(),
    operationsList: z.boolean(),
    aggregatedAssets: z.boolean(),
    myWallet: z.boolean(),
    brazePlacement: z.boolean().optional(),
    pnl: z.boolean(),
    assetDiscoverability: z.boolean(),
    earnUpselling: z.boolean().optional(),
    earnSimulator: z.boolean().optional(),
    q2Tour: z.boolean().optional(),
  },
  {
    enabled: true,
    params: {
      tour: true,
      lazyOnboarding: true,
      assetSection: true,
      operationsList: true,
      aggregatedAssets: true,
      myWallet: true,
      pnl: true,
      assetDiscoverability: true,
      earnUpselling: false,
      earnSimulator: false,
      q2Tour: false,
    },
  },
);
