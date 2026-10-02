// GENERATED FILE - DO NOT EDIT.
//
// Source: schemas/events/amana_escrow.events.json
// Regenerate: node scripts/codegen-events.mjs

/// Event schema version this module was generated from.
pub const EVENT_SCHEMA_VERSION: u32 = 1;

/// Topic tuple for every event the contract emits, in schema order.
///
/// Tests assert emitted topics against these constants, so a rename in
/// the contract that is not reflected in the schema fails the suite.
pub const EVENT_TOPICS: [(&str, &[&str]); 29] = [
    ("InitializedEvent", &["amana", "initialized"]),
    ("TradeCreatedEvent", &["TRDCRT"]),
    ("TradeFundedEvent", &["TRDFND"]),
    ("TradeCancelledEvent", &["TRDCAN"]),
    ("TradeCancelledByBuyerEvent", &["TCNBYR"]),
    ("ContractUpgradedEvent", &["UPGRAD"]),
    ("DeliveryConfirmedEvent", &["DELCNF"]),
    ("FundsReleasedEvent", &["RELSD"]),
    ("DisputeResolvedEvent", &["DISRES"]),
    ("EvidenceSubmittedEvent", &["EVDSUB"]),
    ("DisputeInitiatedEvent", &["DISINI"]),
    ("VideoProofSubmittedEvent", &["VIDPRF"]),
    ("TradeExpiredEvent", &["TRDEXP"]),
    ("DeadlineExtendedEvent", &["DEDEXT"]),
    ("ManifestSubmittedEvent", &["MNFST"]),
    ("MediatorAddedEvent", &["MEDADD"]),
    ("MediatorRemovedEvent", &["MEDREM"]),
    ("FeeRateUpdatedEvent", &["FEEUPD"]),
    ("FeesWithdrawnEvent", &["FEEWTH"]),
    ("PathPaymentInitiatedEvent", &["PTHINT"]),
    ("PathPaymentExecutedEvent", &["PTHPAY"]),
    ("AdminClawbackEvent", &["ADMCLW"]),
    ("ClawbackExecutedEvent", &["CLWBCK"]),
    ("TimelockOperationQueued", &["TLKQUE"]),
    ("TimelockOperationExecuted", &["TLKEXE"]),
    ("TimelockOperationCancelled", &["TLKCAN"]),
    ("ContractUpgradeQueued", &["UPGQUE"]),
    ("AdminTransferProposedEvent", &["ADMPRP"]),
    ("AdminTransferAcceptedEvent", &["ADMACC"]),
];

/// Field names of every event, in declaration order.
pub const EVENT_FIELDS: [(&str, &[&str]); 29] = [
    ("InitializedEvent", &["admin", "fee_bps", "timestamp"]),
    ("TradeCreatedEvent", &["trade_id", "buyer", "seller", "amount"]),
    ("TradeFundedEvent", &["trade_id", "amount"]),
    ("TradeCancelledEvent", &["trade_id", "refund_amount", "caller", "timestamp"]),
    ("TradeCancelledByBuyerEvent", &["trade_id", "buyer"]),
    ("ContractUpgradedEvent", &["admin", "new_wasm_hash"]),
    ("DeliveryConfirmedEvent", &["trade_id", "delivered_at"]),
    ("FundsReleasedEvent", &["trade_id", "seller_amount", "fee_amount"]),
    ("DisputeResolvedEvent", &["trade_id", "seller_payout", "buyer_refund", "mediator"]),
    ("EvidenceSubmittedEvent", &["trade_id", "submitter", "evidence_hash"]),
    ("DisputeInitiatedEvent", &["trade_id", "initiator", "reason_hash"]),
    ("VideoProofSubmittedEvent", &["trade_id", "submitter", "ipfs_cid", "timestamp"]),
    ("TradeExpiredEvent", &["trade_id", "refund_amount", "caller"]),
    ("DeadlineExtendedEvent", &["trade_id", "old_deadline", "new_deadline"]),
    ("ManifestSubmittedEvent", &["trade_id", "seller", "driver_name_hash", "driver_id_hash", "timestamp"]),
    ("MediatorAddedEvent", &["mediator"]),
    ("MediatorRemovedEvent", &["mediator"]),
    ("FeeRateUpdatedEvent", &["old_fee_bps", "new_fee_bps"]),
    ("FeesWithdrawnEvent", &["amount", "destination"]),
    ("PathPaymentInitiatedEvent", &["trade_id", "buyer", "source_token", "source_amount", "dest_min", "path"]),
    ("PathPaymentExecutedEvent", &["trade_id", "buyer", "source_token", "source_amount", "dest_token", "dest_amount"]),
    ("AdminClawbackEvent", &["trade_id", "amount", "admin", "timestamp"]),
    ("ClawbackExecutedEvent", &["trade_id", "clawback_amount", "remaining_amount", "destination", "admin", "schema_version"]),
    ("TimelockOperationQueued", &["operation_id", "operation_type", "queued_at", "execute_after", "admin"]),
    ("TimelockOperationExecuted", &["operation_id", "executed_at"]),
    ("TimelockOperationCancelled", &["operation_id", "cancelled_at", "admin"]),
    ("ContractUpgradeQueued", &["operation_id", "new_wasm_hash", "queued_at", "execute_after"]),
    ("AdminTransferProposedEvent", &["current_admin", "pending_admin"]),
    ("AdminTransferAcceptedEvent", &["old_admin", "new_admin"]),
];
