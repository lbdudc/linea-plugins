export default class MongooseRepository {
    constructor(model) {
        this.model = model;
    }

    async save(object, options) {
        return await object.save(options);
    }

    async getAll(options) {
        return await this.model.find({}, null, options);
    }

    async findById(id, options) {
        return await this.model.findById(id, null, options);
    }

    async update(id, data, options) {
        return await this.model.findByIdAndUpdate(id, data, { new: true, ...options });
    }

    async deleteById(id, options) {
        return await this.model.findByIdAndDelete(id, options);
    }
}