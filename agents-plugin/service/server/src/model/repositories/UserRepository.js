import MongooseRepository from "./MongooseRepository.js";
import User from "../entities/user.js"
import { Container } from "typedi"

export default class UserRepository extends MongooseRepository{
    constructor() {
        super(User);
    }

    async findByUsername(username, options) {
        return await this.model.findOne({ username }, null, options);
    }
}

Container.set(UserRepository, new UserRepository());