"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PinOff } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { priceTierForSaleType, type SaleType } from "@/lib/saleType";
import { tierMismatchError, type PriceTier } from "@/lib/ventasCart";
import { createSale } from "@/app/(dashboard)/ventas/actions";
import { ProductsTable, type ProductResult } from "@/components/ventas/ProductsTable";
import { CartPanel, type CartLine } from "@/components/ventas/CartPanel";
import { AddToCartModal, type AddToCartModalProduct, type AddToCartLine } from "@/components/ventas/AddToCartModal";
import { BranchStockPanel } from "@/components/ventas/BranchStockPanel";
import { ExchangeRateModal } from "@/components/ventas/ExchangeRateModal";

// Anclados: personales por navegador (no por org). Ver comentario original
// en el historial de este archivo.
const PINNED_STORAGE_KEY = "ventas:pinnedProducts";

const DEFAULT_SALE_TYPE_FOR_TIER: Record<PriceTier, SaleType> = {
  cf: "con_factura",
  sf: "sin_factura",
  may: "mayorista",
};

const TIER_PRICE: Record<PriceTier, "priceCfBs" | "priceSfBs" | "priceMayBs"> = {
  cf: "priceCfBs",
  sf: "priceSfBs",
  may: "priceMayBs",
};

export function SalePanel({
  products,
  filters,
  page,
  totalPages,
  buildPageHref,
  exchangeRate,
  canEditExchangeRate,
}: {
  products: ProductResult[];
  filters: React.ReactNode;
  page: number;
  totalPages: number;
  buildPageHref: (page: number) => string;
  exchangeRate: number;
  canEditExchangeRate: boolean;
}) {
  const [saleType, setSaleType] = useState<SaleType>("sin_factura");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerNit, setCustomerNit] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState<ProductResult[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [modalProduct, setModalProduct] = useState<AddToCartModalProduct | null>(null);
  const [exchangeRateModalOpen, setExchangeRateModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
      if (raw) setPinned(JSON.parse(raw));
    } catch {
      // localStorage corrupto o bloqueado: seguir sin anclados.
    }
  }, []);

  function togglePin(product: ProductResult) {
    setPinned((prev) => {
      const next = prev.some((p) => p.id === product.id)
        ? prev.filter((p) => p.id !== product.id)
        : [...prev, product];
      try {
        window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Si no se puede guardar, igual se refleja en la sesión actual.
      }
      return next;
    });
  }

  const pinnedIds = new Set(pinned.map((p) => p.id));
  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  function openAddModal(product: ProductResult, tier: PriceTier) {
    setSelectedProductId(product.id);
    setModalProduct({
      id: product.id,
      code: product.code,
      tier,
      priceBs: product[TIER_PRICE[tier]],
      stock: product.stock,
    });
  }

  // Devuelve el mensaje de error a AddToCartModal (que lo muestra sin
  // cerrarse) o null si la línea se agregó con éxito.
  function handleAddLine(line: AddToCartLine): string | null {
    if (cart.length > 0) {
      const err = tierMismatchError(saleType, line.tier);
      if (err) return err;
    } else {
      setSaleType(DEFAULT_SALE_TYPE_FOR_TIER[line.tier]);
    }
    setCart((prev) => [
      ...prev,
      {
        productId: line.productId,
        code: line.code,
        unitPriceBs: String(line.unitPriceBs),
        quantity: String(line.quantity),
        maxStock: modalProduct?.stock ?? 0,
      },
    ]);
    toast("Añadido en productos para la venta");
    return null;
  }

  function changeSaleType(next: SaleType) {
    if (cart.length > 0) {
      const err = tierMismatchError(saleType, priceTierForSaleType(next));
      if (err) {
        toast(err, "error");
        return;
      }
    }
    setSaleType(next);
  }

  function searchEquivalents(product: ProductResult) {
    const params = new URLSearchParams();
    if (product.internalMm !== null) params.set("mi", String(product.internalMm));
    if (product.externalMm !== null) params.set("me", String(product.externalMm));
    if (product.heightMm !== null) params.set("alt", String(product.heightMm));
    if (product.flangeMm !== null) params.set("pest", String(product.flangeMm));
    if (product.stopMm !== null) params.set("tope", String(product.stopMm));
    router.push(`/ventas?${params.toString()}`);
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  async function onConfirm() {
    if (cart.length === 0) {
      toast("Agrega al menos un producto.", "error");
      return;
    }
    const invalidLine = cart.find(
      (l) =>
        !Number.isFinite(Number(l.unitPriceBs)) ||
        !Number.isInteger(Number(l.quantity)) ||
        Number(l.quantity) <= 0,
    );
    if (invalidLine) {
      toast("Revisa precios y cantidades del carrito.", "error");
      return;
    }

    setLoading(true);
    const formData = new FormData();
    if (customerName) formData.set("customerName", customerName);
    if (customerNit) formData.set("customerNit", customerNit);
    formData.set("saleType", saleType);
    formData.set(
      "items",
      JSON.stringify(
        cart.map((l) => ({
          productId: l.productId,
          unitPriceBs: Number(l.unitPriceBs),
          quantity: Number(l.quantity),
        })),
      ),
    );
    const res = await createSale(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(`Venta registrada: ${res.total} Bs.`);
    setCart([]);
    setCustomerName("");
    setCustomerNit("");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {pinned.length > 0 && (
            <Card className="p-3">
              <div className="flex flex-wrap gap-2">
                {pinned.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-brand-200 bg-brand-50 py-1.5 pl-3 pr-1 text-xs"
                  >
                    <span className="font-medium text-slate-800">{p.code}</span>
                    <span className="flex items-center gap-1 text-slate-500">
                      <span className="rounded bg-emerald-100 px-1 text-emerald-800">CF {p.priceCfBs}</span>
                      <span className="rounded bg-amber-100 px-1 text-amber-800">SF {p.priceSfBs}</span>
                      <span className="rounded bg-rose-100 px-1 text-rose-800">MAY {p.priceMayBs}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => openAddModal(p, priceTierForSaleType(saleType))}
                      className="rounded-full bg-brand-600 px-2 py-0.5 font-medium text-white hover:bg-brand-700"
                    >
                      Agregar {p[TIER_PRICE[priceTierForSaleType(saleType)]]} Bs
                    </button>
                    <button
                      type="button"
                      onClick={() => togglePin(p)}
                      className="rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                      title="Desanclar"
                    >
                      <PinOff className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <ProductsTable
            products={products}
            selectedProductId={selectedProductId}
            onSelectProduct={(p) => setSelectedProductId(p.id)}
            onPriceClick={openAddModal}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            onSearchEquivalents={searchEquivalents}
            page={page}
            totalPages={totalPages}
            buildPageHref={buildPageHref}
          />
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800">Filtros</h3>
              {canEditExchangeRate && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setExchangeRateModalOpen(true)}
                  title="Tasa de Cambio"
                >
                  $
                </Button>
              )}
            </div>
            {filters}
          </Card>

          <BranchStockPanel product={selectedProduct} />
        </div>
      </div>

      <CartPanel
        saleType={saleType}
        onChangeSaleType={changeSaleType}
        cart={cart}
        onRemoveLine={removeLine}
        customerName={customerName}
        onChangeCustomerName={setCustomerName}
        customerNit={customerNit}
        onChangeCustomerNit={setCustomerNit}
        loading={loading}
        onConfirm={onConfirm}
      />

      <AddToCartModal product={modalProduct} onClose={() => setModalProduct(null)} onAdd={handleAddLine} />

      {canEditExchangeRate && (
        <ExchangeRateModal
          open={exchangeRateModalOpen}
          onClose={() => setExchangeRateModalOpen(false)}
          exchangeRate={exchangeRate}
        />
      )}
    </div>
  );
}
