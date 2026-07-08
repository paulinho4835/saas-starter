"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import {
  groupCartByBranch,
  isProductInTransferCart,
  PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR,
  type TransferCartLine,
} from "@/lib/transferCart";
import { createTransferRequest, createTransferShipment } from "@/app/(dashboard)/traspasos/actions";
import { TransferProductsTable, type TransferProduct } from "@/components/traspasos/TransferProductsTable";
import { ProductInfoPanel } from "@/components/traspasos/ProductInfoPanel";
import {
  TransferQuantityModal,
  type TransferModalLine,
  type TransferProceso,
} from "@/components/traspasos/TransferQuantityModal";
import { TransferCartPanel } from "@/components/traspasos/TransferCartPanel";

export function SolicitudEnvioTab({
  products,
  page,
  totalPages,
  baseQuery,
  branches,
  ownBranchId,
  filters,
  canManage,
}: {
  products: TransferProduct[];
  page: number;
  totalPages: number;
  baseQuery: string;
  branches: { id: string; name: string }[];
  ownBranchId: string;
  filters: React.ReactNode;
  canManage: boolean;
}) {
  const [selectedProduct, setSelectedProduct] = useState<TransferProduct | null>(null);
  const [modalProduct, setModalProduct] = useState<TransferProduct | null>(null);
  const [modalProceso, setModalProceso] = useState<TransferProceso | null>(null);
  const [pedidoCart, setPedidoCart] = useState<TransferCartLine[]>([]);
  const [envioCart, setEnvioCart] = useState<TransferCartLine[]>([]);
  const [loadingPedido, setLoadingPedido] = useState(false);
  const [loadingEnvio, setLoadingEnvio] = useState(false);
  const router = useRouter();

  function openModal(product: TransferProduct, proceso: TransferProceso) {
    const cart = proceso === "pedido" ? pedidoCart : envioCart;
    if (isProductInTransferCart(cart, product.id)) {
      toast(PRODUCT_ALREADY_IN_TRANSFER_CART_ERROR, "error");
      return;
    }
    setModalProduct(product);
    setModalProceso(proceso);
  }

  function handleAdd(line: TransferModalLine) {
    if (modalProceso === "pedido") {
      setPedidoCart((prev) => [...prev, line]);
    } else {
      setEnvioCart((prev) => [...prev, line]);
    }
    toast(`Añadido al carrito de ${modalProceso === "pedido" ? "Pedido" : "Envío"}`);
  }

  function removeLine(proceso: TransferProceso, productId: string, branchId: string) {
    const setCart = proceso === "pedido" ? setPedidoCart : setEnvioCart;
    setCart((prev) => prev.filter((l) => !(l.productId === productId && l.branchId === branchId)));
  }

  async function submitCart(proceso: TransferProceso) {
    const cart = proceso === "pedido" ? pedidoCart : envioCart;
    const setLoading = proceso === "pedido" ? setLoadingPedido : setLoadingEnvio;
    const setCart = proceso === "pedido" ? setPedidoCart : setEnvioCart;
    if (cart.length === 0) return;

    setLoading(true);
    const groups = groupCartByBranch(cart).map((g) => ({
      branchId: g.branchId,
      items: g.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
    }));
    const formData = new FormData();
    formData.set("groups", JSON.stringify(groups));
    const action = proceso === "pedido" ? createTransferRequest : createTransferShipment;
    const res = await action(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(proceso === "pedido" ? "Pedido Efectuado Exitosamente" : "Envio Efectuado Exitosamente");
    setCart([]);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TransferProductsTable
            products={products}
            selectedProductId={selectedProduct?.id ?? null}
            onSelectProduct={setSelectedProduct}
            onOpenModal={openModal}
            page={page}
            totalPages={totalPages}
            baseQuery={baseQuery}
            canManage={canManage}
          />
        </div>
        <div className="space-y-4">
          {filters}
          <ProductInfoPanel product={selectedProduct} />
        </div>
      </div>

      {canManage && (pedidoCart.length > 0 || envioCart.length > 0) && (
        <TransferCartPanel
          pedidoCart={pedidoCart}
          envioCart={envioCart}
          onRemovePedido={(productId, branchId) => removeLine("pedido", productId, branchId)}
          onRemoveEnvio={(productId, branchId) => removeLine("envio", productId, branchId)}
          onSubmitPedido={() => submitCart("pedido")}
          onSubmitEnvio={() => submitCart("envio")}
          loadingPedido={loadingPedido}
          loadingEnvio={loadingEnvio}
        />
      )}

      {canManage && (
        <TransferQuantityModal
          product={modalProduct}
          proceso={modalProceso}
          branches={branches}
          ownBranchId={ownBranchId}
          onClose={() => {
            setModalProduct(null);
            setModalProceso(null);
          }}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}
