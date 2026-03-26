declare namespace _default {
    namespace properties {
        namespace minimal {
            const type: string;
        }
        namespace buttons {
            const type_1: string;
            export { type_1 as type };
            export namespace items {
                const type_2: string;
                export { type_2 as type };
                const _enum: string[];
                export { _enum as enum };
            }
        }
        namespace editor_components {
            const type_3: string;
            export { type_3 as type };
            export namespace items_1 {
                const type_4: string;
                export { type_4 as type };
            }
            export { items_1 as items };
        }
        namespace modes {
            const type_5: string;
            export { type_5 as type };
            export namespace items_2 {
                const type_6: string;
                export { type_6 as type };
                const _enum_1: string[];
                export { _enum_1 as enum };
            }
            export { items_2 as items };
            export const minItems: number;
        }
    }
}
export default _default;
