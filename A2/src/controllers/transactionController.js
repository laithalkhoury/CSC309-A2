const prisma = require("../prismaClient");


// POST /transactions - Create a new transaction
const postTransaction = async(req, res, next) => {
    try {
        const { utorid, type, spent, promotionIDs = [], remark = "" } = req.body;

        // Validate required fields
        if (!utorid || !type || spent === undefined) {
            throw new Error("Bad Request");
        }

        // Validate utorid format
        const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
        if (!utoridRegex.test(utorid)) {
            throw new Error("Bad Request");
        }

        //Validate type
        if (type !== "purchase") {
            throw new Error("Bad Request");
        }

        // Validate spent amount
        if (typeof spent !== "number" || spent <= 0) {
            throw new Error("Bad Request");
        }

        // Find the customer by utorid
        const customer = await prisma.user.findUnique({
            where: { utorid }
        });

        if (!customer) {
            throw new Error("Bad Request");
        }
        
        // Validate promotion IDs if provided
        let validPromotions = [];
        if (promotionIDs.length > 0){
            validPromotions = await prisma.promotion.findMany({
                where: {
                    id: { in: promotionIDs },
                    startTime: {lte: new Date() },
                    endTime: {gte: new Date() }
                },
                include: {
                    usedByUsers: true
                }
            });

            // Check if all provided promotion IDs are valid
            if (validPromotions.length !== promotionIDs.length) {
                throw new Error("Bad Request");
            }
            
            // Check if customer has already used any of the promotions
            for (const promotion of validPromotions) {
                if (promotion.type === "onetime") {
                    const alreadyUsed = promotion.usedByUsers.some(user => user.id === customer.id);
                    if (alreadyUsed) {
                        throw new Error("Bad Request");
                    }
                }
            }
            
            // Check minimum spending requirements
            for (const promotion of validPromotions){
                if (promotion.minSpending && spent < promotion.minSpending) {
                    throw new Error("Bad Request");
                }
            }
        }

        // Calculate points 
        let pointsEarned = Math.floor(spent / 0.25);

        // Apply promotions if any
        for (const promotion of validPromotions){
            if (promotion.points) {
                pointsEarned += promotion.points;
            }
            if (promotion.rate) {
                pointsEarned += Math.floor(spent * 100 * promotion.rate);
            }
        }

        // Check if cashier is suspicious (requires manager verification)
        const cashier = req.me; // set by auth middleware
        let suspicious = false;
        if (cashier.suspicious) {
            suspicious = true;
        }

        // Create the transaction
        const transaction = await prisma.transaction.create({
            data: {
                userId: customer.id,
                type: "purchase",
                amount: pointsEarned,
                spent: spent,
                suspicious: suspicious,
                remark: remark || "",
                createdById: cashier.id,
                promotions: {
                    connect: validPromotions.map(promo => ({ id: promo.id }))
                    }
                },
            
            include: {
                promotions: { select: { id: true } }
                }
              });
        
        // Update customer's points if cashier is not suspicious
        if (!suspicious){
            await prisma.user.update({
                where: { id: customer.id },
                data: {
                    points: customer.points + pointsEarned
                }
            });
        }

        // Add promotions used by a user
        await prisma.user.update({
            where: { id: customer.id },
            data: {
                usedPromotions: {
                    connect: validPromotions.map(promo => ({ id: promo.id }))
                }
            }
        });
        
        // Return transaction response
        const statusCode = suspicious ? 201 : 200;
        return res.status(statusCode).json({
            id: transaction.id,
            utorid: customer.utorid,
            type: transaction.type,
            spent: transaction.spent,
            earned: suspicious ? 0 : transaction.amount,
            remark: transaction.remark,
            promotionIds: transaction.promotions.map(p => p.id),
            createdBy: cashier.utorid,
        });
    } catch (error) {
        next(error);
    }
}













// POST /transactions - Create a new adjustment transaction
const adjustmentTransaction = async(req, res, next) => {
    try {
        const { utorid, type, amount, relatedId, promotionIds = [], remark = "" } = req.body;

        // Validate required fields
        if (!utorid || !type || amount === undefined || relatedId === undefined) {
            throw new Error("Bad Request");
        }

        // Validate utorid format
        const utoridRegex = /^[a-zA-Z0-9]{7,8}$/;
        if (!utoridRegex.test(utorid)) {
            throw new Error("Bad Request");
        }

        // Validate type
        if (type !== "adjustment") {
            throw new Error("Bad Request");
        }

        // Validate amount
        if (typeof amount !== "number") {
            throw new Error("Bad Request");
        }

        // Validate relatedId
        if (typeof relatedId !== "number" || relatedId <=0 ) {
            throw new Error("Bad Request");
        }

        // Find the customer by utorid
        const customer = await prisma.user.findUnique({
            where: { utorid }
        });

        // Check if customer exists
        if (!customer) {
            throw new Error("Bad Request");
        }

        // Find the related transaction
        const relatedTransaction = await prisma.transaction.findUnique({
            where: { id: relatedId }
        });

        // Check if related transaction exists
        if (!relatedTransaction) {
            throw new Error("Bad Request");
        }

        // Get the manager creating the adjustment
        const manager = req.me; // set by auth middleware
        
        // Create the adjustment transaction
        const transaction = await prisma.transaction.create({
            data: {
                userId: customer.id,
                type: "adjustment",
                amount: amount,
                remark: remark || "",
                relatedId: relatedTransaction.id,
                createdById: manager.id,
                promotions: {
                    connect: promotionIds.map(promo => ({ id: promo.id }))
                }
            },
            include: {
            promotions: { select: { id: true } }
        }
        });

        // Update customer's points 
        await prisma.user.update({
            where: {id: customer.id },
            data: { points: customer.points + amount }
        });

        // Return transaction response
        return res.status(201).json({
            id: transaction.id,
            utorid: customer.utorid,
            amount: transaction.amount,
            type: transaction.type,
            relatedId: transaction.relatedId,
            remark: transaction.remark,
            promotionIds: transaction.promotions.map(p => p.id),
            createdBy: manager.utorid,
        });
    } catch (error) {
        next(error);
    }
}






// GET /transactions - Retrieve a list of transactions
const getTransactions = async(req, res, next) => {
    try {
        const {
            name, 
            createdBy, 
            suspicious, 
            promotionId, 
            type, 
            relatedId, 
            amount, 
            operator, 
            page = 1, 
            limit = 10 
        } = req.query;

        // Validate pagination parameters
        const pageNum = Number(page);
        const limitNum = Number(limit);
        
        if (isNaN(pageNum) || pageNum < 1) {
            throw new Error("Bad Request");
        }
        
        if (isNaN(limitNum) || limitNum < 1) {
            throw new Error("Bad Request");
        }

        // Build where clause for filtering - ALL filters are applied together (AND logic)
        const whereClause = {};

        // Filter by user name or utorid
        if (name) {
            whereClause.user = {
                OR: [
                    { name: { contains: name } },
                    { utorid: { contains: name } }
                ]
            };
        }

        // Filter by creator utorid
        if (createdBy) {
            whereClause.createdBy = {
                utorid: createdBy
            };
        }

        // Filter by suspicious status
        if (suspicious !== undefined) {
            const suspiciousValue = suspicious === 'true';
            whereClause.suspicious = suspiciousValue;
        }

        // Filter by promotion ID
        if (promotionId) {
            const promoId = Number(promotionId);
            if (isNaN(promoId)) {
                throw new Error("Bad Request");
            }
            whereClause.promotions = {
                some: {
                    id: promoId
                }
            };
        }

        // Filter by transaction type
        if (type) {
            whereClause.type = type;
        }

        // Filter by relatedID
        if (relatedId) {
            if (!type) {
                throw new Error("Bad Request");
            }
            const relId = Number(relatedId);
            if (isNaN(relId)) {
                throw new Error("Bad Request");
            }
            whereClause.relatedId = relId;
        }

        // Filter by amount with operator
        if (amount !== undefined) {
            if (!operator) {
                throw new Error("Bad Request");
            }

            const amountNum = Number(amount);
            if (isNaN(amountNum)) {
                throw new Error("Bad Request");
            }

            if (operator === 'gte') {
                whereClause.amount = { gte: amountNum };
            } else if (operator === 'lte') {
                whereClause.amount = { lte: amountNum };
            } else {
                throw new Error("Bad Request");
            }
        } else if (operator) {
            throw new Error("Bad Request");
        }

        // Calculate skip for pagination
        const skip = (pageNum - 1) * limitNum;

        // Get total count for pagination
        const count = await prisma.transaction.count({
            where: whereClause
        });

        // Get transactions with ALL filters applied
        const transactions = await prisma.transaction.findMany({
            where: whereClause,
            include: {
                user: { select: { utorid: true } },
                createdBy: { select: { utorid: true } },
                promotions: { select: { id: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip: skip,
            take: limitNum
        });

        // Format response
        const results = transactions.map(transaction => ({
            id: transaction.id,
            utorid: transaction.user.utorid,
            amount: transaction.amount,
            type: transaction.type,
            spent: transaction.spent,
            promotionIds: transaction.promotions.map(p => p.id),
            suspicious: transaction.suspicious,
            remark: transaction.remark || "",
            createdBy: transaction.createdBy?.utorid || null,
            ...(transaction.relatedId && { relatedId: transaction.relatedId }),
            ...(transaction.redeemed !== null && { redeemed: transaction.redeemed })
        }));

        return res.status(200).json({
            count: count,
            results: results
        });
    } catch (error) {
        next(error);
    }
};






// GET /transactions/:transactionId - Retrieve a single transaction by ID
const getTransactionById = async(req, res, next) => {
    try {
        const { transactionId } = req.params;

        // Validate transactionId is a number
        const id = Number(transactionId);
        if (isNaN(id) || id <= 0) {
            throw new Error("Bad Request");
        }

        // Find the transaction by ID
        const transaction = await prisma.transaction.findUnique({
            where: { id: id },
            include: {
                user: true,
                createdBy: true,
                promotions: true
            }
        });

        // Check if transaction exists
        if(!transaction) {
            throw new Error("Not Found");
        }

        // Return transaction details
        return res.status(200).json({
            id: transaction.id,
            utorid: transaction.user.utorid,
            type: transaction.type,
            spent: transaction.spent,
            amount: transaction.amount,
            promotionIds: transaction.promotions.map(p => p.id),
            suspicious: transaction.suspicious,
            remark: transaction.remark,
            createdBy: transaction.createdBy.utorid
        });
    } catch (error) {
        next(error);
    }
}





// PATCH /transactions/:transactionId/suspicious - Mark a transaction as suspicious (manager only)
const patchTransactionAsSuspiciousById = async(req, res, next) => {
    try {
        const { transactionId } = req.params;
        const { suspicious } = req.body;

        // Validate transactionId is a number
        const transId = Number(transactionId);
        if (isNaN(transId) || transId <= 0) {
            throw new Error("Bad Request");
        }

        // Validate suspicious field
        if(typeof suspicious !== "boolean") {
            throw new Error("Bad Request");
        }

        // Find the transaction by ID
        let transaction = await prisma.transaction.findUnique({
            where: {id: transId },
            include: { user: true,
                createdBy: true,
                promotions: true
             } 
        })

        // Check if transaction exists
        if (!transaction) {
            throw new Error("Not Found");
        }

        // Check if tranaction suspicious status is already as requested
        if (transaction.suspicious === suspicious){
            return res.status(200).json({
                id: transaction.id,
                utorid: transaction.user.utorid,
                type: transaction.type,
                spent: transaction.spent,
                amount: transaction.amount,
                promotionIds: transaction.promotions.map(p => p.id),
                suspicious: transaction.suspicious,
                remark: transaction.remark,
                createdBy: transaction.createdBy.utorid
            });
        }

        // Update the transaction's suspicious status
        transaction = await prisma.transaction.update({
            where: {id: transId},
            data: {suspicious: suspicious },
            include: { user: true,
                createdBy: true,
                promotions: true
             } 
        })

        // Adjust user's points balance
        let pointAdjustment = 0;

        if (suspicious) {
            // If marking as suspicious, deduct points
            pointAdjustment = -transaction.amount;
        } else{
            // If marking as unsuspicious add points
            pointAdjustment = transaction.amount;
        }

        // Update user's points
        await prisma.user.update({
            where: {id: transaction.userId},
            data: { points: transaction.user.points + pointAdjustment }
        });

        // Return updated transaction details
        return res.status(200).json({
            id: transaction.id,
            utorid: transaction.user.utorid,
            type: transaction.type,
            spent: transaction.spent,
            amount: transaction.amount,
            promotionIds: transaction.promotions.map(p => p.id),
            suspicious: transaction.suspicious,
            remark: transaction.remark,
            createdBy: transaction.createdBy.utorid
        });
    } catch (error) {
        next(error);
    }
}



module.exports = {
    postTransaction,
    getTransactions,
    getTransactionById,
    patchTransactionAsSuspiciousById,
    adjustmentTransaction,
};
