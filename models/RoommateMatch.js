const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const RoommateMatch = sequelize.define('RoommateMatch', {
        match_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        matched_user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        compatibility_score: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('pending', 'accepted', 'rejected'),
            defaultValue: 'pending',
        },
    }, {
        tableName: 'roommate_matches',
        timestamps: false,
    });

    RoommateMatch.associate = (models) => {
        RoommateMatch.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
        RoommateMatch.belongsTo(models.User, {
            foreignKey: 'matched_user_id',
            as: 'matchedUser',
        });
    };

    return RoommateMatch;
};
