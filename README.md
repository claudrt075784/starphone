# Starphone Paris

Single-page React/TypeScript storefront and protected product dashboard for Starphone Paris.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set your Supabase project URL and publishable (or legacy anon) key.
3. In the Supabase SQL Editor, run `supabase/schema.sql`.
4. Create an administrator using **Authentication → Users → Add user**. Public sign-up is intentionally not exposed.
5. In **Authentication → Users → user details → App Metadata**, set `role` to `admin` (equivalent admin-only server operation: `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE email = 'admin@example.com';`).
6. Run `npm run dev`. The store is at `/` and the admin login is at `/admin`.

The Supabase policies authorize product and image writes only for authenticated users whose trusted `app_metadata.role` is `admin`. Never put a Supabase `service_role` secret in this frontend. Product changes are reflected in the storefront through Supabase Realtime.

The price is optional: leaving it empty saves the product with the `unpriced` category. An explicit “without price” selection never displays a price. Product descriptions, additional information, and an HTTPS payment link are optional. Each product has one payment link shared by all its color variants. When a link exists, the storefront shows an “Acheter” button on the product card and detail view. Products can optionally have multiple color variants, each with its own image; choose a default color for the gallery. The storefront product detail lets visitors switch colors and enlarge each image.

To update an existing Supabase project, run the current `supabase/schema.sql` again. It adds the product-detail and payment-link fields without removing existing products.
