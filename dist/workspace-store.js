export const STORAGE_KEY = "etsyshipping.workspace.v1";
export const ORDER_STATES = [
  "待复核",
  "待选物流",
  "仓库处理中",
  "已发货",
  "已取消",
];
export const TASK_STATES = [
  "待领取",
  "拣货中",
  "待称重",
  "待打印",
  "待交运",
  "已交运",
];
export const now = () => new Date().toISOString();
export const uid = (prefix) =>
  `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const field = (key, label, type = "text", options = {}) => ({
  key,
  label,
  type,
  ...options,
});
export const catalogs = {
  stores: {
    title: "店铺与 Etsy 授权",
    singular: "店铺",
    fields: [
      field("code", "店铺短码", "text", { required: true }),
      field("name", "店铺名称", "text", { required: true }),
      field("owner", "负责人"),
      field("warehouse", "默认仓库"),
      field("etsyShopId", "Etsy Shop ID"),
      field("notes", "备注", "textarea"),
    ],
  },
  warehouses: {
    title: "仓库与发件资料",
    singular: "仓库",
    fields: [
      field("code", "仓库代码", "text", { required: true }),
      field("name", "仓库名称", "text", { required: true }),
      field("sender", "发件人", "text", { required: true }),
      field("phone", "联系电话"),
      field("country", "国家代码"),
      field("city", "城市"),
      field("postal", "邮编"),
      field("address", "发件地址", "textarea"),
      field("owner", "处理人员"),
    ],
  },
  presets: {
    title: "物流方案与渠道",
    singular: "物流方案",
    fields: [
      field("name", "方案名称", "text", { required: true }),
      field("provider", "物流商", "select", {
        options: ["YunExpress", "SF IECS", "Yanwen", "其他"],
      }),
      field("account", "物流账号名称"),
      field("channel", "渠道代码", "text", { required: true }),
      field("productCode", "产品代码"),
      field("countries", "支持国家（逗号分隔）"),
      field("paper", "面单规格", "select", {
        options: ["100×150mm", "100×100mm", "A4"],
      }),
      field("weightLimit", "重量上限(g)", "number", { min: 1 }),
      field("notes", "使用说明", "textarea"),
    ],
  },
  skus: {
    title: "SKU 与申报模板",
    singular: "SKU",
    fields: [
      field("code", "内部 SKU", "text", { required: true }),
      field("name", "商品名称", "text", { required: true }),
      field("platformSku", "平台 SKU"),
      field("variation", "规格 / 颜色"),
      field("englishName", "英文申报名"),
      field("hsCode", "HS Code"),
      field("weight", "单件重量(g)", "number", { min: 1, required: true }),
      field("value", "申报价值", "number", { min: 0, required: true }),
      field("currency", "币种", "select", {
        options: ["USD", "CNY", "EUR", "JPY", "GBP"],
      }),
      field("origin", "原产国"),
      field("material", "材质"),
      field("usage", "用途"),
      field("warehouse", "默认仓库"),
      field("notes", "电池 / 液体 / 磁性等说明", "textarea"),
    ],
  },
  templates: {
    title: "面单与打印模板",
    singular: "打印模板",
    fields: [
      field("name", "模板名称", "text", { required: true }),
      field("kind", "单据类型", "select", {
        options: ["仓库拣货单", "演练包裹标签", "转运单"],
      }),
      field("paper", "纸张", "select", {
        options: ["A4", "100×150mm", "100×100mm"],
      }),
      field("version", "模板版本"),
      field("footer", "页脚说明", "textarea"),
    ],
  },
  prices: {
    title: "价格版本",
    singular: "价格版本",
    fields: [
      field("name", "版本名称", "text", { required: true }),
      field("provider", "物流商"),
      field("country", "国家代码"),
      field("firstWeight", "首重(g)", "number", { min: 1, required: true }),
      field("firstPrice", "首重价格", "number", { min: 0, required: true }),
      field("stepWeight", "续重(g)", "number", { min: 1, required: true }),
      field("stepPrice", "续重价格", "number", { min: 0, required: true }),
      field("currency", "币种", "select", { options: ["CNY", "USD", "JPY"] }),
      field("effective", "生效日期", "date", { required: true }),
    ],
  },
};

export function seedWorkspace() {
  const timestamp = now();
  const day = timestamp.slice(0, 10);
  const orders = [
    {
      id: "ORD-001",
      number: "ZY-261123-0142",
      externalId: "ETSY-38102942",
      store: "Hana Metal",
      recipient: "Emma R.",
      country: "US",
      city: "Seattle",
      postal: "98101",
      address: "100 Example Street",
      phone: "",
      email: "",
      product: "Brass bookmark",
      sku: "BM-01",
      variation: "黄铜 / 定制刻字",
      quantity: 2,
      amount: 48,
      currency: "USD",
      weight: 180,
      status: "待复核",
    },
    {
      id: "ORD-002",
      number: "ZY-261123-0139",
      externalId: "ETSY-38102939",
      store: "Hana Metal",
      recipient: "Luca B.",
      country: "IT",
      city: "Milano",
      postal: "20121",
      address: "20 Example Street",
      product: "Custom name plate",
      sku: "NP-01",
      variation: "银色 / 10cm",
      quantity: 1,
      amount: 32,
      currency: "EUR",
      weight: 240,
      status: "待选物流",
    },
    {
      id: "ORD-003",
      number: "ZY-261123-0087",
      externalId: "ETSY-38102887",
      store: "Moon Needle",
      recipient: "Olivia T.",
      country: "GB",
      city: "London",
      postal: "SW1A 1AA",
      address: "30 Example Road",
      product: "Embroidery kit",
      sku: "EK-01",
      variation: "花卉 / 标准套装",
      quantity: 1,
      amount: 29,
      currency: "GBP",
      weight: 320,
      status: "仓库处理中",
    },
    {
      id: "ORD-004",
      number: "ZY-261122-0134",
      externalId: "ETSY-38102734",
      store: "Hana Metal",
      recipient: "Noah S.",
      country: "CA",
      city: "Toronto",
      postal: "M5V 1A1",
      address: "40 Example Avenue",
      product: "Metal luggage tag",
      sku: "LT-01",
      variation: "黑色",
      quantity: 3,
      amount: 54,
      currency: "USD",
      weight: 280,
      status: "已发货",
    },
  ].map((o) => ({
    ...o,
    synthetic: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    deadline: day,
    handler: "admin",
    notes: "演练样例，请勿用于真实发货",
    attachments: [],
  }));
  return {
    version: 1,
    revision: 0,
    orders,
    shipments: [
      {
        id: "SHP-003",
        orderId: "ORD-003",
        provider: "YunExpress",
        channel: "演练标准专线",
        warehouse: "东京仓",
        tracking: "DEMO-YT000003",
        status: "待交运",
        weight: 320,
        fee: 36,
        createdAt: timestamp,
        events: [],
      },
      {
        id: "SHP-004",
        orderId: "ORD-004",
        provider: "SF IECS",
        channel: "演练国际标快",
        warehouse: "上海仓",
        tracking: "DEMO-SF000004",
        status: "运输异常",
        exception: "地址待确认",
        weight: 280,
        fee: 42,
        createdAt: timestamp,
        events: [
          {
            at: timestamp,
            text: "演练事件：收件地址待确认",
            location: "Toronto",
          },
        ],
      },
    ],
    tasks: [
      {
        id: "WH-003",
        orderId: "ORD-003",
        shipmentId: "SHP-003",
        warehouse: "东京仓",
        status: "待领取",
        owner: "",
        weight: 0,
        createdAt: timestamp,
      },
      {
        id: "WH-004",
        orderId: "ORD-004",
        shipmentId: "SHP-004",
        warehouse: "上海仓",
        status: "已交运",
        owner: "admin",
        weight: 280,
        createdAt: timestamp,
      },
    ],
    returns: [
      {
        id: "RET-004",
        orderId: "ORD-004",
        shipmentId: "SHP-004",
        status: "待回填",
      },
    ],
    stores: [
      {
        id: "ST-01",
        code: "HM",
        name: "Hana Metal",
        owner: "admin",
        warehouse: "东京仓",
        enabled: true,
      },
      {
        id: "ST-02",
        code: "MN",
        name: "Moon Needle",
        owner: "admin",
        warehouse: "上海仓",
        enabled: true,
      },
    ],
    warehouses: [
      {
        id: "W-01",
        code: "TYO",
        name: "东京仓",
        sender: "演练发件人",
        country: "JP",
        city: "Tokyo",
        address: "演练地址",
        enabled: true,
      },
      {
        id: "W-02",
        code: "SHA",
        name: "上海仓",
        sender: "演练发件人",
        country: "CN",
        city: "Shanghai",
        address: "演练地址",
        enabled: true,
      },
    ],
    presets: [
      {
        id: "P-01",
        name: "云途标准专线",
        provider: "YunExpress",
        channel: "演练标准专线",
        countries: "US,GB,CA,IT",
        weightLimit: 2000,
        paper: "100×150mm",
        enabled: true,
      },
      {
        id: "P-02",
        name: "顺丰国际标快",
        provider: "SF IECS",
        channel: "演练国际标快",
        countries: "US,CA,JP",
        weightLimit: 5000,
        paper: "100×150mm",
        enabled: true,
      },
    ],
    skus: [
      {
        id: "SKU-01",
        code: "BM-01",
        name: "Brass bookmark",
        englishName: "Brass bookmark",
        weight: 90,
        value: 12,
        currency: "USD",
        hsCode: "830629",
        origin: "CN",
        enabled: true,
      },
      {
        id: "SKU-02",
        code: "NP-01",
        name: "Custom name plate",
        englishName: "Name plate",
        weight: 240,
        value: 16,
        currency: "USD",
        origin: "CN",
        enabled: true,
      },
      {
        id: "SKU-03",
        code: "EK-01",
        name: "Embroidery kit",
        weight: 320,
        value: 18,
        currency: "USD",
        origin: "CN",
        enabled: true,
      },
      {
        id: "SKU-04",
        code: "LT-01",
        name: "Metal luggage tag",
        weight: 90,
        value: 9,
        currency: "USD",
        origin: "CN",
        enabled: true,
      },
    ],
    templates: [
      {
        id: "TPL-01",
        name: "标准仓库拣货单",
        kind: "仓库拣货单",
        paper: "A4",
        version: "1.0",
        footer: "请核对商品规格与数量",
        enabled: true,
      },
      {
        id: "TPL-02",
        name: "演练包裹标签",
        kind: "演练包裹标签",
        paper: "100×150mm",
        version: "1.0",
        enabled: true,
      },
    ],
    prices: [
      {
        id: "PRICE-01",
        name: "演练报价 2026",
        provider: "YunExpress",
        country: "US",
        firstWeight: 100,
        firstPrice: 18,
        stepWeight: 100,
        stepPrice: 6,
        currency: "CNY",
        effective: day,
        enabled: true,
      },
    ],
    audit: [
      {
        id: uid("LOG"),
        at: timestamp,
        actor: "系统",
        action: "初始化演练工作区",
        target: "浏览器本地",
        detail: "样例与真实生产数据隔离",
      },
    ],
    settings: { printer: "系统默认打印机", paper: "A4", autoPrint: false },
  };
}

export class WorkspaceStore {
  constructor(storage, actor = "admin") {
    this.storage = storage;
    this.actor = actor;
    const raw = storage.getItem(STORAGE_KEY);
    this.data = raw ? JSON.parse(raw) : seedWorkspace();
    this.validate(this.data);
  }
  validate(data) {
    if (
      !data ||
      data.version !== 1 ||
      ![
        "orders",
        "shipments",
        "tasks",
        "returns",
        "audit",
        ...Object.keys(catalogs),
      ].every((k) => Array.isArray(data[k]))
    )
      throw new Error(
        "本地工作区数据格式不兼容。请保留浏览器数据并联系维护人员，原数据未被覆盖。",
      );
    for (const key of [
      "orders",
      "shipments",
      "tasks",
      "returns",
      ...Object.keys(catalogs),
    ]) {
      const ids = data[key].map((r) => r?.id);
      if (
        ids.some((id) => typeof id !== "string" || !/^[\w-]+$/.test(id)) ||
        new Set(ids).size !== ids.length
      )
        throw new Error("工作区包含无效或重复记录 ID。");
    }
    if (
      data.orders.some(
        (o) =>
          !Number.isInteger(o.quantity) ||
          o.quantity < 1 ||
          !Number.isFinite(o.amount) ||
          !ORDER_STATES.includes(o.status),
      )
    )
      throw new Error("工作区订单数据无效。");
    if (
      data.shipments.some(
        (s) =>
          !Array.isArray(s.events) ||
          !Number.isFinite(s.weight) ||
          !Number.isFinite(s.fee),
      ) ||
      data.tasks.some(
        (t) =>
          !Number.isFinite(t.weight) ||
          ![...TASK_STATES, "已取消"].includes(t.status),
      )
    )
      throw new Error("工作区物流或仓库数据无效。");
    const orderIds = new Set(data.orders.map((o) => o.id));
    const shipIds = new Set(data.shipments.map((s) => s.id));
    if (
      [...data.shipments, ...data.tasks, ...data.returns].some(
        (r) => !orderIds.has(r.orderId),
      ) ||
      [...data.tasks, ...data.returns].some((r) => !shipIds.has(r.shipmentId))
    )
      throw new Error("工作区业务引用不完整。");
    if (
      !data.settings ||
      typeof data.settings !== "object" ||
      !Number.isInteger(data.revision) ||
      data.revision < 0
    )
      throw new Error("工作区设置或版本无效。");
  }
  commit(action, target, fn, detail = "") {
    const latest = this.storage.getItem(STORAGE_KEY);
    if (latest && JSON.parse(latest).revision !== this.data.revision)
      throw new Error("其他标签页已更新数据，请刷新后再操作。");
    const draft = structuredClone(this.data);
    const result = fn(draft);
    draft.audit.unshift({
      id: uid("LOG"),
      at: now(),
      actor: this.actor,
      action,
      target,
      detail,
    });
    draft.audit = draft.audit.slice(0, 1000);
    draft.revision++;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      throw new Error("浏览器存储空间不足或不可用，修改未保存。请先导出备份。");
    }
    this.data = draft;
    return result;
  }
  saveOrder(values, id) {
    const required = [
      "store",
      "recipient",
      "country",
      "city",
      "postal",
      "address",
      "product",
    ];
    if (required.some((k) => !String(values[k] || "").trim()))
      throw new Error("请填写店铺、完整收件资料和商品名称。");
    if (
      !Number.isInteger(Number(values.quantity)) ||
      Number(values.quantity) < 1
    )
      throw new Error("商品数量必须为正整数。");
    if (!Number.isFinite(Number(values.amount)) || Number(values.amount) < 0)
      throw new Error("订单金额不能小于零。");
    if (!/^[A-Za-z]{2}$/.test(values.country))
      throw new Error("国家使用两位代码，例如 US、GB。");
    if (!["USD", "EUR", "GBP", "CNY", "JPY"].includes(values.currency))
      throw new Error("请选择支持的币种。");
    if (
      !Number.isFinite(Number(values.weight || 0)) ||
      Number(values.weight || 0) < 0
    )
      throw new Error("预估重量不能小于零。");
    const nextId = id || uid("ORD");
    this.commit(id ? "编辑订单" : "创建订单", nextId, (d) => {
      const old = d.orders.find((o) => o.id === id);
      if (id && !old) throw new Error("订单不存在。");
      if (old && !["待复核", "待选物流"].includes(old.status))
        throw new Error("该订单已进入仓库或已结束，不能编辑。");
      if (
        values.externalId &&
        d.orders.some(
          (o) =>
            o.id !== id &&
            o.externalId === values.externalId &&
            o.store === values.store,
        )
      )
        throw new Error("同一店铺已存在该平台订单号。");
      const order = {
        ...old,
        ...values,
        id: nextId,
        quantity: Number(values.quantity),
        amount: Number(values.amount),
        weight: Number(values.weight) || 0,
        country: values.country.toUpperCase(),
        status: "待复核",
        number: old?.number || uid("ZY"),
        synthetic: true,
        handler: this.actor,
        createdAt: old?.createdAt || now(),
        updatedAt: now(),
        attachments: values.attachments || old?.attachments || [],
      };
      if (old) d.orders[d.orders.indexOf(old)] = order;
      else d.orders.unshift(order);
    });
    return nextId;
  }
  review(id, skuCode) {
    this.commit("确认复核", id, (d) => {
      const o = d.orders.find((o) => o.id === id);
      const sku = d.skus.find((s) => s.code === skuCode && s.enabled);
      if (!o || o.status !== "待复核")
        throw new Error("仅待复核订单可以确认。");
      if (!sku) throw new Error("请选择已启用的 SKU。");
      Object.assign(o, {
        sku: sku.code,
        weight: o.weight || Number(sku.weight) * o.quantity,
        status: "待选物流",
        updatedAt: now(),
      });
    });
  }
  createShipment(orderId, values) {
    this.commit("创建演练物流单", orderId, (d) => {
      const o = d.orders.find((o) => o.id === orderId);
      const p = d.presets.find((p) => p.id === values.preset && p.enabled);
      if (!o || o.status !== "待选物流") throw new Error("请先完成订单复核。");
      if (!p) throw new Error("请选择已启用的物流方案。");
      if (!d.warehouses.some((w) => w.name === values.warehouse && w.enabled))
        throw new Error("请选择已启用的发货仓库。");
      const weight = Number(values.weight);
      if (!Number.isFinite(weight) || weight <= 0)
        throw new Error("包裹重量必须大于零。");
      if (
        !Number.isFinite(Number(values.fee || 0)) ||
        Number(values.fee || 0) < 0
      )
        throw new Error("运费不能小于零。");
      if (p.weightLimit && weight > Number(p.weightLimit))
        throw new Error("包裹重量超过当前渠道上限。");
      if (
        p.countries &&
        !p.countries
          .toUpperCase()
          .split(/[,，\s]+/)
          .includes(o.country)
      )
        throw new Error("该物流方案不支持订单目的国。");
      const shipment = {
        id: uid("SHP"),
        orderId,
        provider: p.provider,
        channel: p.channel,
        warehouse: values.warehouse,
        weight,
        fee: Number(values.fee) || 0,
        tracking: uid("DEMO"),
        status: "待交运",
        createdAt: now(),
        events: [
          {
            at: now(),
            text: "创建演练物流单，未请求物流商",
            location: values.warehouse,
          },
        ],
      };
      d.shipments.unshift(shipment);
      d.tasks.unshift({
        id: uid("WH"),
        orderId,
        shipmentId: shipment.id,
        warehouse: values.warehouse,
        status: "待领取",
        owner: "",
        weight: 0,
        createdAt: now(),
      });
      o.status = "仓库处理中";
      o.updatedAt = now();
    });
  }
  cancelShipment(id, reason) {
    if (!reason?.trim()) throw new Error("请填写取消原因。");
    this.commit(
      "取消演练物流单",
      id,
      (d) => {
        const s = d.shipments.find((s) => s.id === id);
        if (!s || s.status === "已取消")
          throw new Error("该物流单不存在或已经取消。");
        if (d.tasks.some((t) => t.shipmentId === id && t.status === "已交运"))
          throw new Error("已交运包裹不可直接取消，请通过异常处理记录结果。");
        s.status = "已取消";
        s.events.unshift({
          at: now(),
          text: `取消演练物流单：${reason}`,
          location: s.warehouse,
        });
        d.tasks
          .filter((t) => t.shipmentId === id)
          .forEach((t) => (t.status = "已取消"));
        const o = d.orders.find((o) => o.id === s.orderId);
        o.status = "待选物流";
        o.updatedAt = now();
      },
      reason,
    );
  }
  advanceTask(id, values = {}) {
    this.commit("推进仓库任务", id, (d) => {
      const t = d.tasks.find((t) => t.id === id);
      if (!t) throw new Error("任务不存在。");
      const index = TASK_STATES.indexOf(t.status);
      if (index < 0 || index === TASK_STATES.length - 1)
        throw new Error("该任务已结束。");
      if (t.status === "待领取") t.owner = this.actor;
      else if (t.owner !== this.actor)
        throw new Error("只能处理自己领取的任务。");
      if (t.status === "待称重") {
        const w = Number(values.weight);
        if (!Number.isFinite(w) || w <= 0)
          throw new Error("请输入有效的实际重量。");
        t.weight = w;
      }
      if (t.status === "待打印" && !values.printed)
        throw new Error("请先预览并确认已经完成打印。");
      if (t.status === "待交运" && !values.confirmed)
        throw new Error("请确认演练包裹已交运。");
      t.status = TASK_STATES[index + 1];
      t.updatedAt = now();
      const s = d.shipments.find((s) => s.id === t.shipmentId);
      if (t.weight) s.weight = t.weight;
      if (t.status === "已交运") {
        s.status = "运输中";
        s.events.unshift({
          at: now(),
          text: "演练包裹已交运",
          location: t.warehouse,
        });
        const o = d.orders.find((o) => o.id === t.orderId);
        o.status = "已发货";
        o.updatedAt = now();
        if (!d.returns.some((r) => r.shipmentId === s.id))
          d.returns.unshift({
            id: uid("RET"),
            orderId: o.id,
            shipmentId: s.id,
            status: "待回填",
          });
      }
    });
  }
  tracking(id, values) {
    if (!values.text?.trim()) throw new Error("请填写物流事件或处理结果。");
    this.commit("记录物流事件", id, (d) => {
      const s = d.shipments.find((s) => s.id === id);
      if (!s || s.status === "已取消") throw new Error("该物流单不可更新。");
      if (
        ["运输中", "运输异常", "已签收"].includes(values.status) &&
        !d.tasks.some((t) => t.shipmentId === id && t.status === "已交运")
      )
        throw new Error("请先完成仓库交运，再记录运输状态。");
      s.events.unshift({
        at: now(),
        text: values.text,
        location: values.location || "",
        source: "人工记录",
      });
      if (["运输中", "运输异常", "已签收"].includes(values.status)) {
        s.status = values.status;
        s.exception = values.status === "运输异常" ? values.text : "";
      }
    });
  }
  confirmReturn(id) {
    this.commit("确认 Etsy 人工回填", id, (d) => {
      const r = d.returns.find((r) => r.id === id);
      if (!r || r.status === "已回填")
        throw new Error("回填任务不存在或已经完成。");
      r.status = "已回填";
      r.at = now();
      r.actor = this.actor;
    });
  }
  saveCatalog(key, values, id) {
    const config = catalogs[key];
    if (!config) throw new Error("未知资料类型。");
    for (const f of config.fields) {
      if (f.required && !String(values[f.key] ?? "").trim())
        throw new Error(`请填写${f.label}。`);
      if (
        f.type === "number" &&
        values[f.key] !== "" &&
        values[f.key] !== undefined &&
        (!Number.isFinite(Number(values[f.key])) ||
          Number(values[f.key]) < (f.min ?? 0))
      )
        throw new Error(`${f.label}数值无效。`);
    }
    this.commit(
      id ? "编辑" + config.singular : "创建" + config.singular,
      id || values.name || values.code,
      (d) => {
        const row = d[key].find((r) => r.id === id);
        const unique = values.code ? "code" : "name";
        if (d[key].some((r) => r.id !== id && r[unique] === values[unique]))
          throw new Error(
            `${config.singular}的${unique === "code" ? "代码" : "名称"}不能重复。`,
          );
        if (
          row &&
          ((key === "stores" &&
            row.name !== values.name &&
            d.orders.some((o) => o.store === row.name)) ||
            (key === "warehouses" &&
              row.name !== values.name &&
              d.tasks.some((t) => t.warehouse === row.name)) ||
            (key === "skus" &&
              row.code !== values.code &&
              d.orders.some((o) => o.sku === row.code)))
        )
          throw new Error(
            "该标识已被业务引用，请保留原名称或代码；可停用后创建新资料。",
          );
        const next = {
          ...row,
          ...values,
          id: id || uid(key.toUpperCase()),
          enabled: row?.enabled ?? true,
          updatedAt: now(),
        };
        if (row) d[key][d[key].indexOf(row)] = next;
        else d[key].push(next);
      },
    );
  }
  toggleCatalog(key, id) {
    if (!Object.hasOwn(catalogs, key)) throw new Error("资料类型不存在。");
    this.commit("切换资料启用状态", id, (d) => {
      const row = d[key]?.find((r) => r.id === id);
      if (!row) throw new Error("资料不存在。");
      row.enabled = !row.enabled;
    });
  }
  archiveOrder(id, reason) {
    if (!reason?.trim()) throw new Error("请填写归档原因。");
    this.commit(
      "归档订单",
      id,
      (d) => {
        const o = d.orders.find((o) => o.id === id);
        if (!o) throw new Error("订单不存在。");
        if (d.shipments.some((s) => s.orderId === id && s.status !== "已取消"))
          throw new Error("该订单存在物流记录，请保留订单用于追溯。");
        o.archived = true;
      },
      reason,
    );
  }
}

export function csvEncode(rows, keys) {
  return (
    "\uFEFF" +
    [keys, ...rows.map((r) => keys.map((k) => r[k] ?? ""))]
      .map((row) =>
        row
          .map((v) => {
            let s = String(v);
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function csvParse(text) {
  text = text.replace(/^\uFEFF/, "");
  let rows = [],
    row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift() || [];
  if (!headers.length || new Set(headers).size !== headers.length)
    throw new Error("CSV 表头缺失或重复。");
  return rows.map((r) =>
    Object.fromEntries(headers.map((k, i) => [k, r[i] || ""])),
  );
}
