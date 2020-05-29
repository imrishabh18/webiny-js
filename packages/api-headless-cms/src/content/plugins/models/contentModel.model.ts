import { validation } from "@webiny/validation";
import {
    pipe,
    withFields,
    withProps,
    string,
    withName,
    fields,
    object,
    ref,
    withHooks,
    setOnce,
    skipOnPopulate
} from "@webiny/commodo";
import createFieldsModel from "./ContentModel/createFieldsModel";
import createUsedFieldsModel from "./ContentModel/createUsedFieldsModel";
import camelCase from "lodash/camelCase";
import pluralize from "pluralize";
import { indexes } from "./indexesField";
import { CmsContext } from "@webiny/api-headless-cms/types";

const required = validation.create("required");

export default ({ createBase, context }: { createBase: Function; context: CmsContext }) => {
    const ContentModelFieldsModel = createFieldsModel(context);
    const UsedFieldsModel = createUsedFieldsModel();

    const CmsContentModel = pipe(
        withName(`CmsContentModel`),
        withFields({
            name: string({
                validation: validation.create("required,maxLength:100"),
                value: "Untitled"
            }),
            modelId: setOnce()(string({ validation: validation.create("required,maxLength:100") })),
            description: string({ validation: validation.create("maxLength:200") }),
            layout: object({ value: [] }),
            group: ref({ instanceOf: context.models.CmsContentModelGroup, validation: required }),
            titleFieldId: string(),

            // Contains a list of all fields that were utilized by existing content entries. If a field is on the list,
            // it cannot be removed/edited anymore.
            usedFields: skipOnPopulate()(fields({ list: true, instanceOf: UsedFieldsModel })),
            fields: fields({
                list: true,
                value: [],
                instanceOf: ContentModelFieldsModel
            }),
            indexes: indexes()
        }),
        withProps({
            pluralizedName() {
                if (!this.name) {
                    return "";
                }

                return pluralize(this.name);
            },
            pluralizedModelId() {
                if (!this.modelId) {
                    return "";
                }

                return pluralize(this.modelId);
            },
            getUniqueIndexFields() {
                const indexFields = [];
                this.indexes.forEach(({ fields }) => {
                    fields.forEach(field => indexFields.push(field));
                });
                return [...new Set(indexFields)];
            }
        }),
        withHooks({
            async beforeDelete() {
                const Model = context.models[this.modelId];
                if (await Model.findOne()) {
                    throw new Error(
                        "Cannot delete content model because there are existing entries."
                    );
                }
            },
            async beforeUpdate() {
                // We must not allow removal of fields that are already in use in content entries.
                const usedFields = this.usedFields || [];
                for (let i = 0; i < usedFields.length; i++) {
                    const usedField = usedFields[i];
                    const existingField = this.fields.find(
                        item => item.fieldId === usedField.fieldId
                    );
                    if (!existingField) {
                        throw new Error(
                            `Cannot remove the field "${usedField.fieldId}" because it's already in use in created content.`
                        );
                    }

                    if (usedField.multipleValues !== existingField.multipleValues) {
                        throw new Error(
                            `Cannot change "multipleValues" for the "${usedField.fieldId}" field because it's already in use in created content.`
                        );
                    }
                }
            },
            async beforeSave() {
                if (this.getField("indexes").isDirty()) {
                    const removeCallback = this.hook("afterSave", async () => {
                        removeCallback();

                        await context.cms.dataManager.generateContentModelIndexes({
                            contentModel: this
                        });
                    });
                }

                const fields = this.fields || [];

                // If no title field set, just use the first "text" field.
                let hasTitleFieldId = false;
                if (this.titleFieldId && fields.find(item => item.fieldId === this.titleFieldId)) {
                    hasTitleFieldId = true;
                }

                if (!hasTitleFieldId) {
                    this.titleFieldId = null;
                    for (let i = 0; i < fields.length; i++) {
                        const field = fields[i];
                        if (field.type === "text" && !field.multipleValues) {
                            this.titleFieldId = field.fieldId;
                            break;
                        }
                    }
                }

                if (this.titleFieldId) {
                    const field = fields.find(item => item.fieldId === this.titleFieldId);
                    if (field.type !== "text") {
                        throw new Error("Only text fields can be used as an entry title.");
                    }

                    if (field.multipleValues) {
                        throw new Error(
                            `Fields that accept multiple values cannot be used as the entry title (tried to use "${this.titleFieldId}" field)`
                        );
                    }
                }

                if (this.isDirty()) {
                    const removeCallback = this.hook("afterSave", async () => {
                        removeCallback();
                        const environment = context.cms.getEnvironment();
                        environment.changedOn = new Date();
                        await environment.save();
                    });
                }
            },
            async beforeCreate() {
                // If there is a modelId assigned, check if it's unique ...
                if (this.modelId) {
                    this.getField("modelId").state.set = false;
                    this.modelId = camelCase(this.modelId);

                    const existing = await CmsContentModel.findOne({
                        query: { modelId: this.modelId }
                    });
                    if (existing) {
                        throw Error(`Content model with modelId "${this.modelId}" already exists.`);
                    }
                    return;
                }

                // ... otherwise, assign a unique modelId automatically.
                const modelIdCamelCase = camelCase(this.name);
                let modelId;
                let counter = 0;

                while (true) {
                    modelId = modelIdCamelCase;
                    if (counter) {
                        modelId += counter;
                    }

                    const exists = await CmsContentModel.count({
                        query: { modelId },
                        limit: 1
                    });

                    if (!exists) {
                        break;
                    }

                    counter++;
                }

                this.getField("modelId").state.set = false;
                this.modelId = modelId;
            }
        })
    )(createBase());

    return CmsContentModel;
};
