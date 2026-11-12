/// Issue #190 — the contract side of the single event schema source.
///
/// `schemas/events/amana_escrow.events.json` is the one place event topics and
/// fields are declared; `scripts/codegen-events.mjs` generates both the Rust
/// constants used here and the TypeScript decoder the backend runs. These tests
/// tie the running contract to those constants, so a topic rename that is not
/// carried into the schema — and therefore not into the decoder — fails here
/// rather than silently halting settlement in production.
#[cfg(test)]
#[allow(clippy::module_inception)]
mod generated_schema_tests {
    extern crate std;

    use crate::EVENT_SCHEMA_VERSION;
    use crate::generated::event_schema;

    #[test]
    fn generated_schema_version_matches_the_contract_constant() {
        assert_eq!(
            event_schema::EVENT_SCHEMA_VERSION,
            EVENT_SCHEMA_VERSION,
            "the generated schema version is stale; run `node scripts/codegen-events.mjs`",
        );
    }

    #[test]
    fn every_event_declares_at_least_one_topic() {
        for (name, topics) in event_schema::EVENT_TOPICS {
            assert!(
                !topics.is_empty(),
                "{name} declares no topics; the decoder dispatches on the first one",
            );
        }
    }

    #[test]
    fn first_topics_are_unique() {
        // The TypeScript decoder keys its dispatch map on the first topic, so
        // two events sharing one would silently shadow each other.
        let mut seen: std::vec::Vec<&str> = std::vec::Vec::new();
        for (name, topics) in event_schema::EVENT_TOPICS {
            let first = topics[0];
            assert!(
                !seen.contains(&first),
                "topic {first} is claimed by more than one event (at {name})",
            );
            seen.push(first);
        }
    }

    #[test]
    fn topics_and_fields_cover_the_same_events() {
        assert_eq!(
            event_schema::EVENT_TOPICS.len(),
            event_schema::EVENT_FIELDS.len(),
        );
        for i in 0..event_schema::EVENT_TOPICS.len() {
            assert_eq!(
                event_schema::EVENT_TOPICS[i].0,
                event_schema::EVENT_FIELDS[i].0,
            );
        }
    }

    #[test]
    fn lifecycle_topics_match_what_the_contract_publishes() {
        // Spot-check the events that drive settlement. These are the exact
        // strings the backend decoder now dispatches on.
        let expected: [(&str, &str); 6] = [
            ("TradeCreatedEvent", "TRDCRT"),
            ("TradeFundedEvent", "TRDFND"),
            ("DeliveryConfirmedEvent", "DELCNF"),
            ("FundsReleasedEvent", "RELSD"),
            ("DisputeInitiatedEvent", "DISINI"),
            ("DisputeResolvedEvent", "DISRES"),
        ];

        for (event_name, topic) in expected {
            let found = event_schema::EVENT_TOPICS
                .iter()
                .find(|(name, _)| *name == event_name)
                .unwrap_or_else(|| panic!("{event_name} missing from the generated schema"));
            assert_eq!(
                found.1[0], topic,
                "{event_name} publishes an unexpected topic"
            );
        }
    }
}
